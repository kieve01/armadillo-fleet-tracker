import type { Express } from 'express'
import {
  BatchDeleteDevicePositionHistoryCommand,
  BatchUpdateDevicePositionCommand,
  CreateTrackerCommand,
  DeleteTrackerCommand,
  ListDevicePositionsCommand,
  ListTrackersCommand,
} from '@aws-sdk/client-location'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { locationClient } from '../../lib/locationClient'
import { broadcastDevicePosition } from '../../lib/wsBroadcast'
import { sendError } from '../../http/sendError'
import { snapToRoad } from '../../lib/snapToRoad'

const dbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const META_TABLE = process.env.TRACKER_META_TABLE ?? 'armadillo-tracker-meta'

export function registerTrackerRoutes(app: Express): void {

  // ── Tracker list / create / delete ───────────────────────────────────────

  app.get('/api/trackers', async (_req, res) => {
    try {
      const trackers = []
      let nextToken: string | undefined
      do {
        const result = await locationClient.send(new ListTrackersCommand({ NextToken: nextToken }))
        trackers.push(...(result.Entries ?? []))
        nextToken = result.NextToken
      } while (nextToken)
      res.json(trackers)
    } catch (err) {
      sendError(res, err)
    }
  })

  app.post('/api/trackers', async (req, res) => {
    try {
      const { trackerName, description } = req.body ?? {}
      if (!trackerName) { res.status(400).json({ message: 'trackerName is required' }); return }
      const result = await locationClient.send(
        new CreateTrackerCommand({
          TrackerName: trackerName,
          Description: description,
          PositionFiltering: 'AccuracyBased',
        }),
      )
      res.json({ trackerName: result.TrackerName, trackerArn: result.TrackerArn })
    } catch (err) {
      sendError(res, err)
    }
  })

  app.delete('/api/trackers/:trackerName', async (req, res) => {
    try {
      await locationClient.send(new DeleteTrackerCommand({ TrackerName: req.params.trackerName }))
      res.sendStatus(204)
    } catch (err) {
      sendError(res, err)
    }
  })

  // ── Tracker meta (display name + groups) ─────────────────────────────────

  app.get('/api/trackers/:trackerName/meta', async (req, res) => {
    try {
      const { trackerName } = req.params
      const result = await dbClient.send(new GetCommand({
        TableName: META_TABLE,
        Key: { trackerName },
      }))
      res.json(result.Item ?? { trackerName, displayName: trackerName, groups: [], deviceGroups: {} })
    } catch (err: any) {
      // Table doesn't exist yet — return defaults instead of error
      if (err?.name === 'ResourceNotFoundException' || err?.__type?.includes('ResourceNotFoundException')) {
        res.json({ trackerName: req.params.trackerName, displayName: req.params.trackerName, groups: [], deviceGroups: {} })
        return
      }
      sendError(res, err)
    }
  })

  app.put('/api/trackers/:trackerName/meta', async (req, res) => {
    try {
      const { trackerName } = req.params
      const { displayName, groups, deviceGroups } = req.body ?? {}
      if (!displayName) { res.status(400).json({ message: 'displayName is required' }); return }
      const item = {
        trackerName,
        displayName,
        groups: groups ?? [],
        deviceGroups: deviceGroups ?? {},
        updatedAt: new Date().toISOString(),
      }
      await dbClient.send(new PutCommand({ TableName: META_TABLE, Item: item }))
      res.json(item)
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException' || err?.__type?.includes('ResourceNotFoundException')) {
        res.status(503).json({ message: 'Meta storage not available yet' })
        return
      }
      sendError(res, err)
    }
  })

  // ── Devices ───────────────────────────────────────────────────────────────

  app.get('/api/trackers/:trackerName/devices', async (req, res) => {
    try {
      const { trackerName } = req.params
      const devices = []
      let nextToken: string | undefined
      do {
        const result = await locationClient.send(
          new ListDevicePositionsCommand({ TrackerName: trackerName, NextToken: nextToken }),
        )
        devices.push(...(result.Entries ?? []))
        nextToken = result.NextToken
      } while (nextToken)
      res.json(
        devices.map((d) => ({
          deviceId: d.DeviceId,
          lng: d.Position?.[0],
          lat: d.Position?.[1],
          speed: d.PositionProperties?.speed != null ? Number(d.PositionProperties.speed) : null,
          heading: d.PositionProperties?.heading != null ? Number(d.PositionProperties.heading) : null,
          updatedAt: d.SampleTime?.toISOString(),
        })),
      )
    } catch (err) {
      sendError(res, err)
    }
  })

  app.delete('/api/trackers/:trackerName/devices/:deviceId', async (req, res) => {
    try {
      const { trackerName, deviceId } = req.params
      await locationClient.send(
        new BatchDeleteDevicePositionHistoryCommand({ TrackerName: trackerName, DeviceIds: [deviceId] }),
      )
      res.sendStatus(204)
    } catch (err) {
      sendError(res, err)
    }
  })

  app.post('/api/trackers/:trackerName/devices/:deviceId/location', async (req, res) => {
    try {
      const { trackerName, deviceId } = req.params
      const { lat, lng, speed, heading } = req.body ?? {}
      if (lat == null || lng == null) { res.status(400).json({ message: 'lat and lng are required' }); return }

      const snapped = await snapToRoad(Number(lat), Number(lng), speed != null ? Number(speed) : null)
      const finalLat = snapped.lat
      const finalLng = snapped.lng

      const positionProperties: Record<string, string> = {}
      if (speed != null) positionProperties.speed = String(speed)
      if (heading != null) positionProperties.heading = String(heading)
      positionProperties.snapped = snapped.snapped ? '1' : '0'

      const sampleTime = new Date()

      await locationClient.send(
        new BatchUpdateDevicePositionCommand({
          TrackerName: trackerName,
          Updates: [{
            DeviceId: deviceId,
            Position: [finalLng, finalLat],
            SampleTime: sampleTime,
            PositionProperties: positionProperties,
          }],
        }),
      )

      try {
        await broadcastDevicePosition({
          trackerName, deviceId,
          lat: finalLat, lng: finalLng,
          speed: speed != null ? Number(speed) : null,
          heading: heading != null ? Number(heading) : null,
          snapped: snapped.snapped,
          updatedAt: sampleTime.toISOString(),
        })
      } catch (error) {
        console.error('Failed to broadcast device position', error)
      }

      res.json({ trackerName, deviceId, lat: finalLat, lng: finalLng, snapped: snapped.snapped })
    } catch (err) {
      sendError(res, err)
    }
  })
}
