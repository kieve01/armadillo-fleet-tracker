import type { Express } from 'express'
import {
  CalculateRoutesCommand,
} from '@aws-sdk/client-geo-routes'
import { geoRoutesClient } from '../../lib/locationClient'
import {
  deleteRoute,
  getRoute,
  listRoutes,
  putRoute,
  type RouteRecord,
  type RouteTravelMode,
} from '../../lib/routesStore'
import { sendError } from '../../http/sendError'

// ─── Helpers de modo de viaje ─────────────────────────────────────────────────
type GeoRoutesMode = 'Car' | 'Truck' | 'Pedestrian'

function toGeoRoutesMode(mode: RouteTravelMode): GeoRoutesMode {
  if (mode === 'Walking') return 'Pedestrian'
  if (mode === 'Truck')   return 'Truck'
  return 'Car'
}

// ─── Extracción de geometría ──────────────────────────────────────────────────
// La v2 con LegGeometryFormat='Simple' devuelve coordenadas en Geometry.LineString

function extractGeometry(legs: any[]): [number, number][] {
  if (!legs?.length) return []
  const result: [number, number][] = []
  for (const leg of legs) {
    const coords: any[] | undefined = leg.Geometry?.LineString
    if (!coords?.length) continue
    for (let i = 0; i < coords.length; i++) {
      const pt = coords[i]
      if (!Array.isArray(pt) || pt.length < 2) continue
      if (result.length && i === 0) {
        const prev = result[result.length - 1]
        if (prev[0] === pt[0] && prev[1] === pt[1]) continue
      }
      result.push([pt[0], pt[1]])
    }
  }
  return result
}

function extractSnappedWaypoints(legs: any[], fallback: [number, number][]): [number, number][] {
  if (!legs?.length) return fallback
  const snapped: [number, number][] = []
  for (const leg of legs) {
    const first = leg.Geometry?.LineString?.[0]
    if (Array.isArray(first) && first.length >= 2) {
      snapped.push([first[0], first[1]])
    }
  }
  const lastLeg  = legs[legs.length - 1]
  const lastLine = lastLeg?.Geometry?.LineString
  const lastPt   = lastLine?.[lastLine.length - 1]
  if (Array.isArray(lastPt) && lastPt.length >= 2) {
    snapped.push([lastPt[0], lastPt[1]])
  }
  return snapped.length >= 2 ? snapped : fallback
}

// ─── Llamada principal a la API v2 ────────────────────────────────────────────

interface CalcInput {
  waypoints:     [number, number][]
  travelMode:    RouteTravelMode
  avoidTolls?:   boolean
  avoidFerries?: boolean
  departureTime?: Date
}

interface CalcOutput {
  geometry:         [number, number][]
  snappedWaypoints: [number, number][]
  distanceKm:       number | null
  durationSeconds:  number | null
}

async function callGeoRoutes(input: CalcInput): Promise<CalcOutput> {
  const mode = toGeoRoutesMode(input.travelMode)

  const intermediary = input.waypoints.slice(1, -1).map(([lng, lat]) => ({
    Position: [lng, lat] as [number, number],
  }))

  const avoidFerries = input.avoidFerries ?? true
  const avoidTolls   = input.avoidTolls   ?? false

  const resp = await geoRoutesClient.send(new CalculateRoutesCommand({
    Origin:            input.waypoints[0],
    Destination:       input.waypoints[input.waypoints.length - 1],
    Waypoints:         intermediary.length ? intermediary : undefined,
    TravelMode:        mode,
    DepartureTime:     (input.departureTime ?? new Date()).toISOString(),
    LegGeometryFormat: 'Simple',
    MeasurementSystem: 'Metric',
    // Opciones de evitación según modo
    ...(mode === 'Car'   ? { CarOptions:   { AvoidFerries: avoidFerries, AvoidTolls: avoidTolls } } : {}),
    ...(mode === 'Truck' ? { TruckOptions: { AvoidFerries: avoidFerries, AvoidTolls: avoidTolls } } : {}),
  }))

  const legs     = resp.Routes?.[0]?.Legs ?? []
  const summary  = resp.Routes?.[0]?.Summary

  return {
    geometry:         extractGeometry(legs),
    snappedWaypoints: extractSnappedWaypoints(legs, input.waypoints),
    // v2: Distance en metros, Duration en segundos
    distanceKm:      summary?.Distance != null ? summary.Distance / 1000 : null,
    durationSeconds: summary?.Duration   ?? null,
  }
}

function isNoRouteError(err: any): boolean {
  const name    = String(err?.name    ?? '')
  const message = String(err?.message ?? '')
  return (
    name.includes('RouteNotFoundException') ||
    name.includes('ValidationException')    ||
    message.includes('No route found')              ||
    message.includes('cannot be reached')           ||
    message.includes('Route cannot be calculated')
  )
}

// ─── Express routes ───────────────────────────────────────────────────────────

export function registerRouteRoutes(app: Express): void {

  app.get('/api/routes', async (_req, res) => {
    try {
      res.json(await listRoutes())
    } catch (err) {
      sendError(res, err)
    }
  })

  // Calcular ruta óptima (sin guardar)
  app.post('/api/routes/calculate', async (req, res) => {
    try {
      const waypoints = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) {
        res.status(400).json({ message: 'At least 2 waypoints are required' })
        return
      }

      const travelMode    = parseTravelMode(req.body?.travelMode) ?? 'Car'
      const avoidTolls    = req.body?.avoidTolls === true
      const departureTime = req.body?.departureTime
        ? new Date(req.body.departureTime)
        : new Date()

      let result: CalcOutput
      try {
        result = await callGeoRoutes({ waypoints, travelMode, avoidTolls, avoidFerries: true, departureTime })
      } catch (awsErr) {
        if (isNoRouteError(awsErr)) {
          res.status(422).json({
            message: 'No se encontró una ruta terrestre entre los puntos seleccionados. Verifica que no estén en el mar o en zonas sin vías.',
            code: 'NO_ROUTE',
          })
          return
        }
        throw awsErr
      }

      res.json({
        geometry:         result.geometry,
        distance:         result.distanceKm,
        durationSeconds:  result.durationSeconds,
        travelMode,
        departureTime:    departureTime.toISOString(),
        snappedWaypoints: result.snappedWaypoints,
      })
    } catch (err) {
      sendError(res, err)
    }
  })

  // Guardar ruta
  app.put('/api/routes/:routeId', async (req, res) => {
    try {
      const { routeId } = req.params
      const waypoints   = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) {
        res.status(400).json({ message: 'At least 2 waypoints are required' })
        return
      }

      const travelMode = parseTravelMode(req.body?.travelMode)
      if (!travelMode) {
        res.status(400).json({ message: 'travelMode must be one of Car, Truck or Walking' })
        return
      }

      let result: CalcOutput
      try {
        result = await callGeoRoutes({ waypoints, travelMode, avoidFerries: true, departureTime: new Date() })
      } catch (awsErr) {
        if (isNoRouteError(awsErr)) {
          res.status(422).json({
            message: 'No se encontró una ruta terrestre entre los puntos. Verifica que no estén en zonas sin vías o en el mar.',
            code: 'NO_ROUTE',
          })
          return
        }
        throw awsErr
      }

      const now      = new Date().toISOString()
      const existing = await getRoute(routeId)

      const route: RouteRecord = {
        routeId,
        waypoints,
        geometry:        result.geometry,
        travelMode,
        distance:        result.distanceKm,
        durationSeconds: result.durationSeconds,
        createdAt:       existing?.createdAt ?? now,
        updatedAt:       now,
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

// ─── Helpers de parseo ────────────────────────────────────────────────────────

function parseWaypoints(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return []
  const waypoints: [number, number][] = []
  for (const point of value) {
    if (
      Array.isArray(point) && point.length === 2 &&
      typeof point[0] === 'number' && Number.isFinite(point[0]) &&
      typeof point[1] === 'number' && Number.isFinite(point[1])
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
