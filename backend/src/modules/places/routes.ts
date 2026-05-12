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

// Construye label legible con los datos que AWS sí tiene para Lima
function buildLabel(item: any): string {
  const addr = item.Address ?? {}
  const parts: string[] = []

  // Calle (lo más específico disponible)
  if (addr.Street) parts.push(addr.Street)
  else if (item.Title) parts.push(item.Title)

  // Distrito o localidad para diferenciar calles homónimas
  if (addr.District)       parts.push(addr.District)
  else if (addr.Locality)  parts.push(addr.Locality)

  // Ciudad/municipio si es diferente
  if (addr.Municipality && addr.Municipality !== addr.Locality) {
    parts.push(addr.Municipality)
  }

  // Código postal como referencia adicional
  if (addr.PostalCode) parts.push(addr.PostalCode)

  return parts.filter(Boolean).join(', ') || item.Title || 'Lugar desconocido'
}

export function registerPlaceRoutes(app: Express): void {

  app.get('/api/places/suggest', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim()
      if (q.length < 2) { res.json([]); return }

      const result = await geoPlacesClient.send(new SearchTextCommand({
        QueryText:    q,
        MaxResults:   8,
        BiasPosition: LIMA_POSITION,
        Filter: { IncludeCountries: ['PER'], BoundingBox: LIMA_BBOX },
        Language: 'es',
      }))

      let items: any[] = result.ResultItems ?? []

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
          const key = r.PlaceId ?? (r as any).Title
          if (!seen.has(key)) { items.push(r); seen.add(key) }
        }
      }

      res.json(
        items
          .filter((r: any) => r.Position)
          .slice(0, 8)
          .map((r: any) => ({
            text:     buildLabel(r),
            placeId:  r.PlaceId ?? '',
            position: r.Position as [number, number],
          }))
      )
    } catch (err) { sendError(res, err) }
  })

  app.get('/api/places/resolve-id', async (req, res) => {
    try {
      const placeId = String(req.query.id ?? '').trim()
      if (!placeId) { res.status(400).json({ message: 'id is required' }); return }

      const result = await geoPlacesClient.send(new GetPlaceCommand({
        PlaceId: placeId, Language: 'es',
      }))

      if (!result.Position) { res.status(404).json({ message: 'Lugar no encontrado' }); return }
      const [lng, lat] = result.Position
      res.json({ label: buildLabel({ Address: result.Address, Title: result.Title }), lng, lat, point: [lng, lat] })
    } catch (err) { sendError(res, err) }
  })

  app.get('/api/places/resolve', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim()
      if (!q) { res.status(400).json({ message: 'q is required' }); return }

      // Coordenadas desde click en mapa
      const coordMatch = q.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/)
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1])
        const lng = parseFloat(coordMatch[2])
        try {
          const rev = await geoPlacesClient.send(new ReverseGeocodeCommand({
            QueryPosition: [lng, lat], MaxResults: 1, Language: 'es',
          }))
          const item = rev.ResultItems?.[0]
          if (item?.Position) {
            const [rLng, rLat] = item.Position
            res.json({ label: buildLabel(item), lng: rLng, lat: rLat, point: [rLng, rLat] })
            return
          }
        } catch {}
        res.json({ label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lng, lat, point: [lng, lat] })
        return
      }

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
          QueryText:    q, MaxResults: 1, BiasPosition: LIMA_POSITION,
          Filter: { IncludeCountries: ['PER'] }, Language: 'es',
        }))
        item = broader.ResultItems?.[0]
      }

      if (!item?.Position) { res.status(404).json({ message: 'Lugar no encontrado' }); return }
      const [lng, lat] = item.Position
      res.json({ label: buildLabel(item), lng, lat, point: [lng, lat] })
    } catch (err) { sendError(res, err) }
  })

  // Debug endpoint
  app.get('/api/places/debug', async (req, res) => {
    try {
      const q = String(req.query.q ?? 'Jr Ancash 2800').trim()
      const result = await geoPlacesClient.send(new SearchTextCommand({
        QueryText: q, MaxResults: 3, BiasPosition: LIMA_POSITION,
        Filter: { IncludeCountries: ['PER'] }, Language: 'es',
      }))
      res.json(result.ResultItems ?? [])
    } catch (err) { sendError(res, err) }
  })
}
