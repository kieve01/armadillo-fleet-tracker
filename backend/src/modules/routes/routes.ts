import type { Express } from 'express'
import { CalculateRouteCommand, type Leg } from '@aws-sdk/client-location'
import { locationClient, ROUTE_CALCULATOR } from '../../lib/locationClient'
import {
  deleteRoute,
  getRoute,
  listRoutes,
  putRoute,
  type RouteRecord,
  type RouteTravelMode,
} from '../../lib/routesStore'
import { sendError } from '../../http/sendError'

export function registerRouteRoutes(app: Express): void {
  app.get('/api/routes', async (_req, res) => {
    try {
      res.json(await listRoutes())
    } catch (err) {
      sendError(res, err)
    }
  })

  app.put('/api/routes/:routeId', async (req, res) => {
    try {
      const { routeId } = req.params
      if (!ROUTE_CALCULATOR) { res.status(400).json({ message: 'ROUTE_CALCULATOR is not configured' }); return }

      const waypoints = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) { res.status(400).json({ message: 'At least 2 waypoints are required' }); return }

      const travelMode = parseTravelMode(req.body?.travelMode)
      if (!travelMode) { res.status(400).json({ message: 'travelMode must be one of Car, Truck or Walking' }); return }

      const departurePosition = waypoints[0]
      const destinationPosition = waypoints[waypoints.length - 1]
      const waypointPositions = waypoints.slice(1, -1)

      const routeResponse = await locationClient.send(
        new CalculateRouteCommand({
          CalculatorName: ROUTE_CALCULATOR,
          DeparturePosition: departurePosition,
          DestinationPosition: destinationPosition,
          WaypointPositions: waypointPositions.length ? waypointPositions : undefined,
          TravelMode: travelMode,
          IncludeLegGeometry: true,
        }),
      )

      const geometry = getGeometryFromLegs(routeResponse.Legs, waypoints)
      const now = new Date().toISOString()
      const existing = await getRoute(routeId)

      const route: RouteRecord = {
        routeId,
        waypoints,
        geometry,
        travelMode,
        distance: routeResponse.Summary?.Distance ?? null,
        durationSeconds: routeResponse.Summary?.DurationSeconds ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }

      await putRoute(route)
      res.json(route)
    } catch (err) {
      sendError(res, err)
    }
  })

  app.delete('/api/routes/:routeId', async (req, res) => {
    try {
      await deleteRoute(req.params.routeId)
      res.sendStatus(204)
    } catch (err) {
      sendError(res, err)
    }
  })
}

function parseWaypoints(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return []
  const waypoints: [number, number][] = []
  for (const point of value) {
    if (
      Array.isArray(point)
      && point.length === 2
      && typeof point[0] === 'number'
      && Number.isFinite(point[0])
      && typeof point[1] === 'number'
      && Number.isFinite(point[1])
    ) {
      waypoints.push([point[0], point[1]])
    }
  }
  return waypoints
}

function parseTravelMode(value: unknown): RouteTravelMode | null {
  if (value === 'Car' || value === 'Truck' || value === 'Walking') return value
  if (value == null) return 'Car'
  return null
}

function getGeometryFromLegs(legs: Leg[] | undefined, fallback: [number, number][]): [number, number][] {
  if (!legs?.length) return fallback
  const result: [number, number][] = []
  for (const leg of legs) {
    const lineString = leg.Geometry?.LineString
    if (!lineString?.length) continue
    for (let i = 0; i < lineString.length; i++) {
      const point = lineString[i]
      if (
        !Array.isArray(point)
        || point.length !== 2
        || typeof point[0] !== 'number'
        || !Number.isFinite(point[0])
        || typeof point[1] !== 'number'
        || !Number.isFinite(point[1])
      ) {
        continue
      }
      if (result.length && i === 0) {
        const prev = result[result.length - 1]
        if (prev[0] === point[0] && prev[1] === point[1]) continue
      }
      result.push([point[0], point[1]])
    }
  }
  return result.length ? result : fallback
}
