import type { Express } from 'express'
import {
  SearchTextCommand,
  GetPlaceCommand,
  ReverseGeocodeCommand,
} from '@aws-sdk/client-geo-places'
import { geoPlacesClient } from '../../lib/locationClient'
import { sendError } from '../../http/sendError'

const LIMA_POSITION: [number, number] = [-77.0428, -12.0464]
const LIMA_BBOX: [number, number, number, number] = [-77.22, -12.22, -76.82, -11.82]

// Construye label completo con número de calle
function buildAddressLabel(item: any): string {
  const addr = item.Address ?? {}
  const parts: string[] = []

  // Calle + número (lo más específico)
  if (addr.Street && addr.AddressNumber) {
    parts.push(`${addr.Street} ${addr.AddressNumber}`)
  } else if (addr.Street) {
    parts.push(addr.Street)
  } else if (item.Title) {
    parts.push(item.Title)
  }

  // Distrito / barrio
  if (addr.District)    parts.push(addr.District)
  else if (addr.SubRegion) parts.push(addr.SubRegion)

  // Ciudad
  if (addr.Municipality && addr.Municipality !== parts[0]) parts.push(addr.Municipality)

  return parts.filter(Boolean).join(', ') || item.Title || item.Label || 'Lugar desconocido'
}

export function registerPlaceRoutes(app: Express): void {

  // ── Sugerencias ────────────────────────────────────────────────────────────
  // Usa SearchText en lugar de Autocomplete: devuelve direcciones exactas con número
  app.get('/api/places/suggest', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim()
      if (q.length < 2) { res.json([]); return }

      // SearchText con bias a Lima — máxima precisión para calles con número
      const result = await geoPlacesClient.send(new SearchTextCommand({
        QueryText:    q,
        MaxResults:   8,
        BiasPosition: LIMA_POSITION,
        Filter: {
          IncludeCountries: ['PER'],
          BoundingBox: LIMA_BBOX,
        },
        Language: 'es',
        // AdditionalFeatures para obtener Address completa
        AdditionalFeatures: ['TimeZone'],
      }))

      let items = result.ResultItems ?? []

      // Si pocos resultados locales, ampliar a todo Perú
      if (items.length < 3) {
        const broader = await geoPlacesClient.send(new SearchTextCommand({
          QueryText:    q,
          MaxResults:   8,
          BiasPosition: LIMA_POSITION,
          Filter: { IncludeCountries: ['PER'] },
          Language: 'es',
        }))
        const seen = new Set(items.map((r: any) => r.PlaceId ?? r.Title))
        for (const r of broader.ResultItems ?? []) {
          const key = (r as any).PlaceId ?? (r as any).Title
          if (!seen.has(key)) { items.push(r); seen.add(key) }
        }
      }

      res.json(
        items
          .filter((r: any) => r.Position)  // solo resultados con coordenadas
          .slice(0, 8)
          .map((r: any) => ({
            text:     buildAddressLabel(r),
            placeId:  r.PlaceId ?? '',
            // Incluir coordenadas directamente para evitar un round-trip de resolve
            position: r.Position as [number, number] | undefined,
          }))
      )
    } catch (err) {
      sendError(res, err)
    }
  })

  // ── Resolver placeId exacto ────────────────────────────────────────────────
  app.get('/api/places/resolve-id', async (req, res) => {
    try {
      const placeId = String(req.query.id ?? '').trim()
      if (!placeId) { res.status(400).json({ message: 'id is required' }); return }

      const result = await geoPlacesClient.send(new GetPlaceCommand({
        PlaceId:  placeId,
        Language: 'es',
      }))

      if (!result.Position) {
        res.status(404).json({ message: 'Lugar no encontrado' }); return
      }

      const [lng, lat] = result.Position
      const label = buildAddressLabel({ Address: result.Address, Title: result.Title })
      res.json({ label, lng, lat, point: [lng, lat] as [number, number] })
    } catch (err) {
      sendError(res, err)
    }
  })

  // ── Resolver texto libre (fallback, coordenadas reversas) ──────────────────
  app.get('/api/places/resolve', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim()
      if (!q) { res.status(400).json({ message: 'q is required' }); return }

      // Detectar si es "lat,lng" (reverse geocode desde clic en mapa)
      const coordMatch = q.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/)
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1])
        const lng = parseFloat(coordMatch[2])
        try {
          const rev = await geoPlacesClient.send(new ReverseGeocodeCommand({
            QueryPosition: [lng, lat],
            MaxResults: 1,
            Language: 'es',
          }))
          const item = rev.ResultItems?.[0]
          if (item?.Position) {
            const [rLng, rLat] = item.Position
            const label = buildAddressLabel({ Address: item.Address, Title: item.Title })
            res.json({ label, lng: rLng, lat: rLat, point: [rLng, rLat] as [number, number] })
            return
          }
        } catch {}
        // Fallback: devolver las coordenadas tal cual
        res.json({ label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lng, lat, point: [lng, lat] })
        return
      }

      // Búsqueda de texto — SearchText es más preciso que Geocode para direcciones
      const result = await geoPlacesClient.send(new SearchTextCommand({
        QueryText:    q,
        MaxResults:   1,
        BiasPosition: LIMA_POSITION,
        Filter: { IncludeCountries: ['PER'], BoundingBox: LIMA_BBOX },
        Language: 'es',
      }))

      let item: any = result.ResultItems?.[0]

      if (!item) {
        const broader = await geoPlacesClient.send(new SearchTextCommand({
          QueryText:    q,
          MaxResults:   1,
          BiasPosition: LIMA_POSITION,
          Filter: { IncludeCountries: ['PER'] },
          Language: 'es',
        }))
        item = broader.ResultItems?.[0]
      }

      if (!item?.Position) {
        res.status(404).json({ message: 'Lugar no encontrado' }); return
      }

      const [lng, lat] = item.Position
      const label = buildAddressLabel(item)
      res.json({ label, lng, lat, point: [lng, lat] as [number, number] })
    } catch (err) {
      sendError(res, err)
    }
  })

  // ── Debug: ver respuesta raw de AWS para diagnóstico ──────────────────────
  app.get('/api/places/debug', async (req, res) => {
    try {
      const q = String(req.query.q ?? 'Jr Ancash 2800').trim()
      const result = await geoPlacesClient.send(new SearchTextCommand({
        QueryText:    q,
        MaxResults:   3,
        BiasPosition: LIMA_POSITION,
        Filter: { IncludeCountries: ['PER'] },
        Language: 'es',
      }))
      res.json(result.ResultItems ?? [])
    } catch (err) {
      sendError(res, err)
    }
  })
}
