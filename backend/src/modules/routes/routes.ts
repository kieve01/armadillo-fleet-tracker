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

  // ── Calcular ruta óptima (sin guardar) ────────────────────────────────────
  // Usado por el calculador de ruta en frontend.
  // Aplica: snap-to-road, evitar ferries/mar, tráfico histórico por hora.
  app.post('/api/routes/calculate', async (req, res) => {
    try {
      if (!ROUTE_CALCULATOR) {
        res.status(400).json({ message: 'ROUTE_CALCULATOR is not configured' })
        return
      }

      const waypoints = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) {
        res.status(400).json({ message: 'At least 2 waypoints are required' })
        return
      }

      const travelMode   = parseTravelMode(req.body?.travelMode) ?? 'Car'
      const avoidTolls   = req.body?.avoidTolls === true
      // DepartureTime activa el modelo de tráfico histórico de AWS Location.
      // Si el cliente manda una hora de salida la usamos; si no, usamos ahora.
      const departureTime = req.body?.departureTime
        ? new Date(req.body.departureTime)
        : new Date()

      const departurePosition   = waypoints[0]
      const destinationPosition = waypoints[waypoints.length - 1]
      const waypointPositions   = waypoints.slice(1, -1)

      let routeResponse
      try {
        routeResponse = await locationClient.send(
          new CalculateRouteCommand({
            CalculatorName:     ROUTE_CALCULATOR,
            DeparturePosition:  departurePosition,
            DestinationPosition: destinationPosition,
            WaypointPositions:  waypointPositions.length ? waypointPositions : undefined,
            TravelMode:         travelMode,
            DepartureTime:      departureTime,
            IncludeLegGeometry: true,
            // Evitar ferries y travesías marítimas — clave para Lima/Perú
            CarModeOptions: travelMode === 'Car' || travelMode === 'Truck'
              ? { AvoidFerries: true, AvoidTolls: avoidTolls }
              : undefined,
            TruckModeOptions: travelMode === 'Truck'
              ? { AvoidFerries: true, AvoidTolls: avoidTolls }
              : undefined,
          }),
        )
      } catch (awsErr: any) {
        // AWS devuelve estos errores cuando los puntos no tienen red vial alcanzable
        const code = awsErr?.name ?? awsErr?.Code ?? ''
        if (
          code === 'RouteNotFoundException' ||
          code === 'ValidationException' ||
          awsErr?.message?.includes('No route found') ||
          awsErr?.message?.includes('cannot be reached')
        ) {
          res.status(422).json({
            message: 'No se encontró una ruta terrestre entre los puntos seleccionados. Verifica que no estén en el mar o en zonas sin vías.',
            code: 'NO_ROUTE',
          })
          return
        }
        throw awsErr
      }

      const geometry = getGeometryFromLegs(routeResponse.Legs, waypoints)

      res.json({
        geometry,
        distance:        routeResponse.Summary?.Distance ?? null,
        durationSeconds: routeResponse.Summary?.DurationSeconds ?? null,
        travelMode,
        departureTime:   departureTime.toISOString(),
        // Los puntos snapped son el primer punto de cada leg — más precisos que los enviados
        snappedWaypoints: getSnappedWaypoints(routeResponse.Legs, waypoints),
      })
    } catch (err) {
      sendError(res, err)
    }
  })

  // ── Guardar ruta (trazar manual o guardar desde calculador) ───────────────
  app.put('/api/routes/:routeId', async (req, res) => {
    try {
      const { routeId } = req.params
      if (!ROUTE_CALCULATOR) {
        res.status(400).json({ message: 'ROUTE_CALCULATOR is not configured' })
        return
      }

      const waypoints = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) {
        res.status(400).json({ message: 'At least 2 waypoints are required' })
        return
      }

      const travelMode = parseTravelMode(req.body?.travelMode)
      if (!travelMode) {
        res.status(400).json({ message: 'travelMode must be one of Car, Truck or Walking' })
        return
      }

      const departurePosition   = waypoints[0]
      const destinationPosition = waypoints[waypoints.length - 1]
      const waypointPositions   = waypoints.slice(1, -1)

      let routeResponse
      try {
        routeResponse = await locationClient.send(
          new CalculateRouteCommand({
            CalculatorName:      ROUTE_CALCULATOR,
            DeparturePosition:   departurePosition,
            DestinationPosition: destinationPosition,
            WaypointPositions:   waypointPositions.length ? waypointPositions : undefined,
            TravelMode:          travelMode,
            DepartureTime:       new Date(),
            IncludeLegGeometry:  true,
            CarModeOptions: travelMode === 'Car' || travelMode === 'Truck'
              ? { AvoidFerries: true, AvoidTolls: false }
              : undefined,
            TruckModeOptions: travelMode === 'Truck'
              ? { AvoidFerries: true, AvoidTolls: false }
              : undefined,
          }),
        )
      } catch (awsErr: any) {
        const code = awsErr?.name ?? awsErr?.Code ?? ''
        if (
          code === 'RouteNotFoundException' ||
          code === 'ValidationException' ||
          awsErr?.message?.includes('No route found') ||
          awsErr?.message?.includes('cannot be reached')
        ) {
          res.status(422).json({
            message: 'No se encontró una ruta terrestre entre los puntos. Verifica que no estén en zonas sin vías o en el mar.',
            code: 'NO_ROUTE',
          })
          return
        }
        throw awsErr
      }

      const geometry = getGeometryFromLegs(routeResponse.Legs, waypoints)
      const now      = new Date().toISOString()
      const existing = await getRoute(routeId)

      const route: RouteRecord = {
        routeId,
        waypoints,
        geometry,
        travelMode,
        distance:        routeResponse.Summary?.Distance ?? null,
        durationSeconds: routeResponse.Summary?.DurationSeconds ?? null,
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function getGeometryFromLegs(legs: Leg[] | undefined, fallback: [number, number][]): [number, number][] {
  if (!legs?.length) return fallback
  const result: [number, number][] = []
  for (const leg of legs) {
    const lineString = leg.Geometry?.LineString
    if (!lineString?.length) continue
    for (let i = 0; i < lineString.length; i++) {
      const point = lineString[i]
      if (
        !Array.isArray(point) || point.length !== 2 ||
        typeof point[0] !== 'number' || !Number.isFinite(point[0]) ||
        typeof point[1] !== 'number' || !Number.isFinite(point[1])
      ) continue
      if (result.length && i === 0) {
        const prev = result[result.length - 1]
        if (prev[0] === point[0] && prev[1] === point[1]) continue
      }
      result.push([point[0], point[1]])
    }
  }
  return result.length ? result : fallback
}

// Extrae los puntos snapped (inicio de cada leg) — son las coords reales en red vial
function getSnappedWaypoints(legs: Leg[] | undefined, fallback: [number, number][]): [number, number][] {
  if (!legs?.length) return fallback
  const snapped: [number, number][] = []
  for (const leg of legs) {
    const first = leg.Geometry?.LineString?.[0]
    if (Array.isArray(first) && first.length === 2 &&
        typeof first[0] === 'number' && typeof first[1] === 'number') {
      snapped.push([first[0], first[1]])
    }
  }
  // Agregar el último punto del último leg
  const lastLeg  = legs[legs.length - 1]
  const lastLine = lastLeg?.Geometry?.LineString
  const lastPt   = lastLine?.[lastLine.length - 1]
  if (Array.isArray(lastPt) && lastPt.length === 2 &&
      typeof lastPt[0] === 'number' && typeof lastPt[1] === 'number') {
    snapped.push([lastPt[0], lastPt[1]])
  }
  return snapped.length >= 2 ? snapped : fallback
}
