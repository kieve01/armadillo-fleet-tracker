import type { Express } from 'express'
import {
  BatchDeleteGeofenceCommand,
  ListGeofencesCommand,
  PutGeofenceCommand,
} from '@aws-sdk/client-location'
import { locationClient, GEOFENCE_COLLECTION } from '../../lib/locationClient'
import { sendError } from '../../http/sendError'

export function registerGeofenceRoutes(app: Express): void {
  app.get('/api/geofences', async (_req, res) => {
    try {
      const geofences = []
      let nextToken: string | undefined
      do {
        const result = await locationClient.send(
          new ListGeofencesCommand({ CollectionName: GEOFENCE_COLLECTION, NextToken: nextToken }),
        )
        geofences.push(...(result.Entries ?? []))
        nextToken = result.NextToken
      } while (nextToken)
      res.json(geofences)
    } catch (err) {
      sendError(res, err)
    }
  })

  app.put('/api/geofences/:geofenceId', async (req, res) => {
    try {
      const { geofenceId } = req.params
      const { Geometry } = req.body ?? {}
      if (!Geometry) { res.status(400).json({ message: 'Geometry is required' }); return }
      await locationClient.send(
        new PutGeofenceCommand({ CollectionName: GEOFENCE_COLLECTION, GeofenceId: geofenceId, Geometry }),
      )
      res.json({ GeofenceId: geofenceId })
    } catch (err) {
      sendError(res, err)
    }
  })

  app.delete('/api/geofences/:geofenceId', async (req, res) => {
    try {
      await locationClient.send(
        new BatchDeleteGeofenceCommand({
          CollectionName: GEOFENCE_COLLECTION,
          GeofenceIds: [req.params.geofenceId],
        }),
      )
      res.sendStatus(204)
    } catch (err) {
      sendError(res, err)
    }
  })
}
