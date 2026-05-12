import type { Express } from 'express'
import {
  SearchTextCommand,
  GetPlaceCommand,
  ReverseGeocodeCommand,
} from '@aws-sdk/client-geo-places'
import { geoPlacesClient, GOOGLE_MAPS_API_KEY, USE_GOOGLE } from '../../lib/locationClient'
import { sendError } from '../../http/sendError'

const LIMA_POSITION: [number, number] = [-77.0428, -12.0464]
const LIMA_BBOX: [number, number, number, number] = [-77.22, -12.22, -76.82, -11.82]

// ─── Google Places API ────────────────────────────────────────────────────────

const GOOGLE_AUTOCOMPLETE_URL  = 'https://places.googleapis.com/v1/places:autocomplete'
const GOOGLE_GEOCODE_URL       = 'https://maps.googleapis.com/maps/api/geocode/json'
const GOOGLE_REVERSE_URL       = 'https://maps.googleapis.com/maps/api/geocode/json'

async function googleSuggest(q: string): Promise<{ text: string; placeId: string; position?: [number, number] }[]> {
  const resp = await fetch(GOOGLE_AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   GOOGLE_MAPS_API_KEY!,
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text',
    },
    body: JSON.stringify({
      input:               q,
      locationBias:        { circle: { center: { latitude: -12.0464, longitude: -77.0428 }, radius: 50000 } },
      includedRegionCodes: ['PE'],
      languageCode:        'es',
    }),
  })
  if (!resp.ok) return []
  const data: any = await resp.json()
  return (data.suggestions ?? [])
    .filter((s: any) => s.placePrediction)
    .map((s: any) => ({
      text:    s.placePrediction.text?.text ?? '',
      placeId: s.placePrediction.placeId ?? '',
    }))
}

async function googleResolveId(placeId: string): Promise<{ label: string; point: [number, number] } | null> {
  const resp = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key':   GOOGLE_MAPS_API_KEY!,
      'X-Goog-FieldMask': 'displayName,formattedAddress,location',
      'Accept-Language':  'es',
    },
  })
  if (!resp.ok) return null
  const data: any = await resp.json()
  if (!data.location) return null
  const label = data.formattedAddress ?? data.displayName?.text ?? placeId
  return { label, point: [data.location.longitude, data.location.latitude] }
}

async function googleGeocode(q: string): Promise<{ label: string; lng: number; lat: number; point: [number, number] } | null> {
  const url = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(q)}&key=${GOOGLE_MAPS_API_KEY}&language=es&region=PE&bounds=-12.22,-77.22|-11.82,-76.82`
  const resp = await fetch(url)
  if (!resp.ok) return null
  const data: any = await resp.json()
  const result = data.results?.[0]
  if (!result) return null
  const { lat, lng } = result.geometry.location
  return { label: result.formatted_address, lng, lat, point: [lng, lat] }
}

async function googleReverseGeocode(lat: number, lng: number): Promise<{ label: string; point: [number, number] } | null> {
  const url = `${GOOGLE_REVERSE_URL}?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}&language=es`
  const resp = await fetch(url)
  if (!resp.ok) return null
  const data: any = await resp.json()
  const result = data.results?.[0]
  if (!result) return null
  return { label: result.formatted_address, point: [lng, lat] }
}

// ─── AWS Places API ───────────────────────────────────────────────────────────

function buildLabel(item: any): string {
  const addr = item.Address ?? {}
  const parts: string[] = []
  if (addr.Street)          parts.push(addr.Street)
  else if (item.Title)      parts.push(item.Title)
  if (addr.District)        parts.push(addr.District)
  else if (addr.Locality)   parts.push(addr.Locality)
  if (addr.Municipality && addr.Municipality !== addr.Locality) parts.push(addr.Municipality)
  if (addr.PostalCode)      parts.push(addr.PostalCode)
  return parts.filter(Boolean).join(', ') || item.Title || 'Lugar desconocido'
}

// ─── Express routes ───────────────────────────────────────────────────────────

export function registerPlaceRoutes(app: Express): void {

  app.get('/api/places/suggest', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim()
      if (q.length < 2) { res.json([]); return }

      if (USE_GOOGLE) {
        const results = await googleSuggest(q)
        res.json(results.slice(0, 8))
        return
      }

      // AWS fallback
      const result = await geoPlacesClient.send(new SearchTextCommand({
        QueryText: q, MaxResults: 8, BiasPosition: LIMA_POSITION,
        Filter: { IncludeCountries: ['PER'], BoundingBox: LIMA_BBOX }, Language: 'es',
      }))
      let items: any[] = result.ResultItems ?? []
      if (items.length < 3) {
        const broader = await geoPlacesClient.send(new SearchTextCommand({
          QueryText: q, MaxResults: 8, BiasPosition: LIMA_POSITION,
          Filter: { IncludeCountries: ['PER'] }, Language: 'es',
        }))
        const seen = new Set(items.map((r: any) => r.PlaceId ?? r.Title))
        for (const r of broader.ResultItems ?? []) {
          const key = r.PlaceId ?? (r as any).Title
          if (!seen.has(key)) { items.push(r); seen.add(key) }
        }
      }
      res.json(items.filter((r: any) => r.Position).slice(0, 8).map((r: any) => ({
        text: buildLabel(r), placeId: r.PlaceId ?? '', position: r.Position as [number, number],
      })))
    } catch (err) { sendError(res, err) }
  })

  app.get('/api/places/resolve-id', async (req, res) => {
    try {
      const placeId = String(req.query.id ?? '').trim()
      if (!placeId) { res.status(400).json({ message: 'id is required' }); return }

      if (USE_GOOGLE) {
        const result = await googleResolveId(placeId)
        if (!result) { res.status(404).json({ message: 'Lugar no encontrado' }); return }
        res.json({ label: result.label, lng: result.point[0], lat: result.point[1], point: result.point })
        return
      }

      // AWS fallback
      const result = await geoPlacesClient.send(new GetPlaceCommand({ PlaceId: placeId, Language: 'es' }))
      if (!result.Position) { res.status(404).json({ message: 'Lugar no encontrado' }); return }
      const [lng, lat] = result.Position
      res.json({ label: buildLabel({ Address: result.Address, Title: result.Title }), lng, lat, point: [lng, lat] })
    } catch (err) { sendError(res, err) }
  })

  app.get('/api/places/resolve', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim()
      if (!q) { res.status(400).json({ message: 'q is required' }); return }

      // Coordenadas desde click en mapa — igual para ambos proveedores
      const coordMatch = q.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/)
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1])
        const lng = parseFloat(coordMatch[2])
        if (USE_GOOGLE) {
          const result = await googleReverseGeocode(lat, lng)
          if (result) { res.json({ label: result.label, lng, lat, point: [lng, lat] }); return }
        } else {
          try {
            const rev = await geoPlacesClient.send(new ReverseGeocodeCommand({
              QueryPosition: [lng, lat], MaxResults: 1, Language: 'es',
            }))
            const item = rev.ResultItems?.[0]
            if (item?.Position) {
              const [rLng, rLat] = item.Position
              res.json({ label: buildLabel(item), lng: rLng, lat: rLat, point: [rLng, rLat] }); return
            }
          } catch {}
        }
        res.json({ label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lng, lat, point: [lng, lat] })
        return
      }

      if (USE_GOOGLE) {
        const result = await googleGeocode(q)
        if (!result) { res.status(404).json({ message: 'Lugar no encontrado' }); return }
        res.json(result)
        return
      }

      // AWS fallback
      const result = await geoPlacesClient.send(new SearchTextCommand({
        QueryText: q, MaxResults: 1, BiasPosition: LIMA_POSITION,
        Filter: { IncludeCountries: ['PER'], BoundingBox: LIMA_BBOX }, Language: 'es',
      }))
      let item: any = result.ResultItems?.[0]
      if (!item) {
        const broader = await geoPlacesClient.send(new SearchTextCommand({
          QueryText: q, MaxResults: 1, BiasPosition: LIMA_POSITION,
          Filter: { IncludeCountries: ['PER'] }, Language: 'es',
        }))
        item = broader.ResultItems?.[0]
      }
      if (!item?.Position) { res.status(404).json({ message: 'Lugar no encontrado' }); return }
      const [lng, lat] = item.Position
      res.json({ label: buildLabel(item), lng, lat, point: [lng, lat] })
    } catch (err) { sendError(res, err) }
  })

  app.get('/api/places/debug', async (req, res) => {
    try {
      const q = String(req.query.q ?? 'Jr Ancash 2800').trim()
      if (USE_GOOGLE) {
        const suggestions = await googleSuggest(q)
        res.json({ provider: 'google', suggestions })
        return
      }
      const result = await geoPlacesClient.send(new SearchTextCommand({
        QueryText: q, MaxResults: 3, BiasPosition: LIMA_POSITION,
        Filter: { IncludeCountries: ['PER'] }, Language: 'es',
      }))
      res.json({ provider: 'aws', results: result.ResultItems ?? [] })
    } catch (err) { sendError(res, err) }
  })
}
