import type { Express } from 'express'
import {
  AutocompleteCommand,
  GeocodeCommand,
} from '@aws-sdk/client-geo-places'
import { geoPlacesClient } from '../../lib/locationClient'
import { sendError } from '../../http/sendError'

// Bounding box de Perú aproximada (lon_min, lat_min, lon_max, lat_max)
const PERU_BBOX: [number, number, number, number] = [-81.3, -18.4, -68.6, -0.0]
// Lima como punto de bias
const LIMA_POSITION: [number, number] = [-77.0428, -12.0464]

export function registerPlaceRoutes(app: Express): void {

  // Sugerencias de autocompletado filtradas a Perú
  app.get('/api/places/suggest', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim()
      if (q.length < 2) { res.json([]); return }

      const result = await geoPlacesClient.send(new AutocompleteCommand({
        QueryText:      q,
        MaxResults:     6,
        // Filtrar al bounding box de Perú
        Filter: {
          BoundingBox:  PERU_BBOX,
          // Incluir categorías relevantes para fleet tracking: direcciones, lugares, vías
          IncludeCountries: ['PER'],
        },
        BiasPosition:   LIMA_POSITION,
        // Idioma en español
        Language:       'es',
      }))

      res.json(
        (result.ResultItems ?? [])
          .filter(r => r.Title)
          .map(r => ({
            text:    r.Title,
            placeId: r.PlaceId ?? '',
          }))
      )
    } catch (err) {
      sendError(res, err)
    }
  })

  // Resolver texto a coordenadas (geocodificación)
  app.get('/api/places/resolve', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim()
      if (!q) { res.status(400).json({ message: 'q is required' }); return }

      const result = await geoPlacesClient.send(new GeocodeCommand({
        QueryText:    q,
        MaxResults:   1,
        // Bias hacia Lima / Perú
        BiasPosition: LIMA_POSITION,
        Filter: {
          IncludeCountries: ['PER'],
        },
        Language: 'es',
      }))

      const item = result.ResultItems?.[0]
      if (!item?.Position) {
        res.status(404).json({ message: 'Lugar no encontrado' }); return
      }

      const [lng, lat] = item.Position
      res.json({
        label: item.Title ?? q,
        lng,
        lat,
        point: [lng, lat] as [number, number],
      })
    } catch (err) {
      sendError(res, err)
    }
  })
}
