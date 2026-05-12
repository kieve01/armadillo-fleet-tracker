import type { Express } from 'express'
import { CalculateRoutesCommand } from '@aws-sdk/client-geo-routes'
import { geoRoutesClient } from '../../lib/locationClient'
import {
  deleteRoute, getRoute, listRoutes, putRoute,
  type RouteRecord, type RouteTravelMode,
} from '../../lib/routesStore'
import { sendError } from '../../http/sendError'

type GeoRoutesMode = 'Car' | 'Truck' | 'Pedestrian'

function toGeoRoutesMode(mode: RouteTravelMode): GeoRoutesMode {
  if (mode === 'Walking') return 'Pedestrian'
  if (mode === 'Truck')   return 'Truck'
  return 'Car'
}

function extractGeometry(legs: any[]): [number, number][] {
  if (!legs?.length) return []
  const result: [number, number][] = []
  for (const leg of legs) {
    const coords: any[] = leg.Geometry?.LineString ?? []
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
    if (Array.isArray(first) && first.length >= 2) snapped.push([first[0], first[1]])
  }
  const lastLine = legs[legs.length - 1]?.Geometry?.LineString
  const lastPt   = lastLine?.[lastLine.length - 1]
  if (Array.isArray(lastPt) && lastPt.length >= 2) snapped.push([lastPt[0], lastPt[1]])
  return snapped.length >= 2 ? snapped : fallback
}

export interface TrafficSpan {
  startIndex: number
  endIndex:   number
  congestion: number   // 0=verde, 0.5=naranja, 1=rojo
  speedKmh:   number | null
}

// Extrae spans de tráfico desde los legs de la respuesta geo-routes v2.
// Cada leg tiene Spans[], cada span tiene GeometryOffset (índice en LineString del leg),
// Duration (duración real con tráfico) y TypicalDuration (sin tráfico).
function extractTrafficSpans(legs: any[], geometry: [number, number][]): TrafficSpan[] {
  if (!legs?.length || !geometry.length) return []
  const spans: TrafficSpan[] = []
  let geoOffset = 0  // offset acumulado en geometry[] global

  for (const leg of legs) {
    const legCoords: any[] = leg.Geometry?.LineString ?? []
    const legSpans: any[]  = leg.Spans ?? []
    if (!legSpans.length) {
      geoOffset += Math.max(0, legCoords.length - 1)
      continue
    }

    for (let si = 0; si < legSpans.length; si++) {
      const span     = legSpans[si]
      const nextSpan = legSpans[si + 1]

      const startInLeg: number = span.GeometryOffset ?? 0
      const endInLeg:   number = nextSpan?.GeometryOffset ?? (legCoords.length - 1)

      const globalStart = geoOffset + startInLeg
      const globalEnd   = Math.min(geoOffset + endInLeg, geometry.length - 1)

      // Congestión = cuánto más lento va respecto a lo típico
      const duration        = span.Duration        ?? null
      const typicalDuration = span.TypicalDuration ?? null
      let congestion = 0
      if (duration != null && typicalDuration != null && typicalDuration > 0) {
        // ratio: 0 = igual que típico (verde), 1 = 60% más lento (rojo)
        const ratio = (duration - typicalDuration) / typicalDuration
        congestion  = Math.min(1, Math.max(0, ratio / 0.6))
      }

      // Velocidad del segmento (de DynamicSpeed o SpeedLimit)
      const speedKmh = span.DynamicSpeed?.BestCaseSpeed
        ?? span.DynamicSpeed?.TurnDuration
        ?? span.SpeedLimit?.MaxSpeed
        ?? null

      if (globalStart < globalEnd) {
        spans.push({ startIndex: globalStart, endIndex: globalEnd, congestion, speedKmh })
      }
    }

    geoOffset += Math.max(0, legCoords.length - 1)
  }

  return spans
}

interface CalcInput {
  waypoints:        [number, number][]
  travelMode:       RouteTravelMode
  avoidTolls?:      boolean
  avoidFerries?:    boolean
  departureTime?:   Date
  maxAlternatives?: number
}

interface RouteResult {
  geometry:         [number, number][]
  snappedWaypoints: [number, number][]
  distanceKm:       number | null
  durationSeconds:  number | null
  trafficSpans:     TrafficSpan[]
}

async function callGeoRoutes(input: CalcInput): Promise<RouteResult[]> {
  const mode         = toGeoRoutesMode(input.travelMode)
  const avoidFerries = input.avoidFerries ?? true
  const avoidTolls   = input.avoidTolls   ?? false
  // MaxAlternatives = rutas adicionales (0=solo principal, 1=+1 alt, 2=+2 alts)
  const extraAlts    = Math.min((input.maxAlternatives ?? 3) - 1, 2)

  const intermediary = input.waypoints.slice(1, -1).map(([lng, lat]) => ({
    Position: [lng, lat] as [number, number],
  }))

  const resp = await geoRoutesClient.send(new CalculateRoutesCommand({
    Origin:            input.waypoints[0],
    Destination:       input.waypoints[input.waypoints.length - 1],
    Waypoints:         intermediary.length ? intermediary : undefined,
    TravelMode:        mode,
    DepartureTime:     (input.departureTime ?? new Date()).toISOString(),
    LegGeometryFormat: 'Simple',
    ...(extraAlts > 0 ? { MaxAlternatives: extraAlts } : {}),
    // Datos de tráfico por segmento
    SpanAdditionalFeatures: [
      'Duration',
      'TypicalDuration',
      'DynamicSpeed',
      'SpeedLimit',
    ] as any,
    ...(mode === 'Car'   ? { CarOptions:   { AvoidFerries: avoidFerries, AvoidTolls: avoidTolls } } : {}),
    ...(mode === 'Truck' ? { TruckOptions: { AvoidFerries: avoidFerries, AvoidTolls: avoidTolls } } : {}),
  }))

  const routes = resp.Routes ?? []
  if (!routes.length) return []

  return routes.map((route: any) => {
    const legs    = route.Legs ?? []
    const summary = route.Summary
    const geometry = extractGeometry(legs)
    return {
      geometry,
      snappedWaypoints: extractSnappedWaypoints(legs, input.waypoints),
      distanceKm:      summary?.Distance != null ? summary.Distance / 1000 : null,
      durationSeconds: summary?.Duration ?? null,
      trafficSpans:    extractTrafficSpans(legs, geometry),
    }
  })
}

function isNoRouteError(err: any): boolean {
  const name    = String(err?.name    ?? '')
  const message = String(err?.message ?? '')
  return (
    name.includes('RouteNotFoundException') ||
    name.includes('ValidationException')    ||
    message.includes('No route found')             ||
    message.includes('cannot be reached')          ||
    message.includes('Route cannot be calculated')
  )
}

export function registerRouteRoutes(app: Express): void {

  app.get('/api/routes', async (_req, res) => {
    try { res.json(await listRoutes()) }
    catch (err) { sendError(res, err) }
  })

  // ── Calcular con alternativas y tráfico por segmento ──────────────────────
  app.post('/api/routes/calculate', async (req, res) => {
    try {
      const waypoints = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) {
        res.status(400).json({ message: 'At least 2 waypoints are required' }); return
      }

      const travelMode      = parseTravelMode(req.body?.travelMode) ?? 'Car'
      const avoidTolls      = req.body?.avoidTolls === true
      const maxAlternatives = Math.min(Math.max(Number(req.body?.alternatives ?? 3), 1), 3)

      let results: RouteResult[]
      try {
        results = await callGeoRoutes({
          waypoints, travelMode, avoidTolls, avoidFerries: true,
          departureTime: new Date(), maxAlternatives,
        })
      } catch (awsErr) {
        if (isNoRouteError(awsErr)) {
          res.status(422).json({ message: 'No se encontró una ruta terrestre entre los puntos seleccionados.', code: 'NO_ROUTE' })
          return
        }
        throw awsErr
      }

      if (!results.length) {
        res.status(422).json({ message: 'No se encontró ruta', code: 'NO_ROUTE' }); return
      }

      const [main, ...alts] = results
      res.json({
        geometry:         main.geometry,
        distance:         main.distanceKm,
        durationSeconds:  main.durationSeconds,
        trafficSpans:     main.trafficSpans,
        travelMode,
        departureTime:    new Date().toISOString(),
        snappedWaypoints: main.snappedWaypoints,
        alternatives: alts.map(a => ({
          geometry:         a.geometry,
          distance:         a.distanceKm,
          durationSeconds:  a.durationSeconds,
          trafficSpans:     a.trafficSpans,
          snappedWaypoints: a.snappedWaypoints,
        })),
      })
    } catch (err) { sendError(res, err) }
  })

  // ── Debug: ver respuesta raw de geo-routes ────────────────────────────────
  app.post('/api/routes/debug', async (req, res) => {
    try {
      const waypoints = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) { res.status(400).json({ message: 'Need 2 waypoints' }); return }
      const resp = await geoRoutesClient.send(new CalculateRoutesCommand({
        Origin:            waypoints[0],
        Destination:       waypoints[1],
        TravelMode:        'Car',
        DepartureTime:     new Date().toISOString(),
        LegGeometryFormat: 'Simple',
        MaxAlternatives:   2,
        SpanAdditionalFeatures: ['Duration', 'TypicalDuration', 'DynamicSpeed', 'SpeedLimit'] as any,
        
      }))
      // Devolver estructura resumida para diagnóstico
      res.json({
        routeCount: (resp.Routes ?? []).length,
        routes: (resp.Routes ?? []).map((r: any, i: number) => ({
          index: i,
          summary: r.Summary,
          legCount: (r.Legs ?? []).length,
          firstLegSpanCount: r.Legs?.[0]?.Spans?.length ?? 0,
          firstSpanSample: r.Legs?.[0]?.Spans?.[0],
        }))
      })
    } catch (err) { sendError(res, err) }
  })

  // ── Guardar ruta ──────────────────────────────────────────────────────────
  app.put('/api/routes/:routeId', async (req, res) => {
    try {
      const { routeId } = req.params
      const waypoints   = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) {
        res.status(400).json({ message: 'At least 2 waypoints are required' }); return
      }
      const travelMode = parseTravelMode(req.body?.travelMode)
      if (!travelMode) {
        res.status(400).json({ message: 'travelMode must be one of Car, Truck or Walking' }); return
      }

      let results: RouteResult[]
      try {
        results = await callGeoRoutes({ waypoints, travelMode, avoidFerries: true, departureTime: new Date(), maxAlternatives: 1 })
      } catch (awsErr) {
        if (isNoRouteError(awsErr)) {
          res.status(422).json({ message: 'No se encontró ruta', code: 'NO_ROUTE' }); return
        }
        throw awsErr
      }

      if (!results.length) {
        res.status(422).json({ message: 'No se encontró ruta', code: 'NO_ROUTE' }); return
      }

      const main = results[0]
      const now  = new Date().toISOString()
      const existing = await getRoute(routeId)

      const route: RouteRecord = {
        routeId, waypoints, geometry: main.geometry, travelMode,
        distance: main.distanceKm, durationSeconds: main.durationSeconds,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      }
      await putRoute(route)
      res.json(route)
    } catch (err) { sendError(res, err) }
  })

  app.delete('/api/routes/:routeId', async (req, res) => {
    try { await deleteRoute(req.params.routeId); res.sendStatus(204) }
    catch (err) { sendError(res, err) }
  })
}

function parseWaypoints(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return []
  const waypoints: [number, number][] = []
  for (const point of value) {
    if (Array.isArray(point) && point.length === 2 &&
        typeof point[0] === 'number' && Number.isFinite(point[0]) &&
        typeof point[1] === 'number' && Number.isFinite(point[1])) {
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
