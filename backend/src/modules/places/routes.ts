import type { Express } from 'express'
import {
  SearchPlaceIndexForSuggestionsCommand,
  SearchPlaceIndexForTextCommand,
} from '@aws-sdk/client-location'
import { locationClient, PLACE_INDEX } from '../../lib/locationClient'
import { sendError } from '../../http/sendError'

export function registerPlaceRoutes(app: Express): void {

  // Sugerencias de autocompletado filtradas a Perú
  app.get('/api/places/suggest', async (req, res) => {
    try {
      if (!PLACE_INDEX) { res.status(400).json({ message: 'PLACE_INDEX not configured' }); return }
      const q = String(req.query.q ?? '').trim()
      if (q.length < 2) { res.json([]); return }

      const result = await locationClient.send(
        new SearchPlaceIndexForSuggestionsCommand({
          IndexName:       PLACE_INDEX,
          Text:            q,
          MaxResults:      6,
          FilterCountries: ['PER'],
          BiasPosition:    [-77.0428, -12.0464], // Lima como centro de bias
        }),
      )

      res.json(
        (result.Results ?? [])
          .filter(r => r.Text && r.PlaceId)
          .map(r => ({ text: r.Text, placeId: r.PlaceId }))
      )
    } catch (err) {
      sendError(res, err)
    }
  })

  // Resolver texto o placeId a coordenadas
  app.get('/api/places/resolve', async (req, res) => {
    try {
      if (!PLACE_INDEX) { res.status(400).json({ message: 'PLACE_INDEX not configured' }); return }
      const q = String(req.query.q ?? '').trim()
      if (!q) { res.status(400).json({ message: 'q is required' }); return }

      const result = await locationClient.send(
        new SearchPlaceIndexForTextCommand({
          IndexName:       PLACE_INDEX,
          Text:            q,
          MaxResults:      1,
          FilterCountries: ['PER'],
          BiasPosition:    [-77.0428, -12.0464],
        }),
      )

      const place = result.Results?.[0]
      if (!place?.Place?.Geometry?.Point) {
        res.status(404).json({ message: 'Lugar no encontrado' }); return
      }

      const [lng, lat] = place.Place.Geometry.Point
      res.json({ label: place.Place.Label ?? q, lng, lat, point: [lng, lat] })
    } catch (err) {
      sendError(res, err)
    }
  })
}
