import type { Express } from 'express'
import { CalculateRoutesCommand } from '@aws-sdk/client-geo-routes'
import { geoRoutesClient, GOOGLE_MAPS_API_KEY, USE_GOOGLE } from '../../lib/locationClient'
import {
  deleteRoute, getRoute, listRoutes, putRoute,
  type RouteRecord, type RouteTravelMode,
} from '../../lib/routesStore'
import { sendError } from '../../http/sendError'

// ─── Tipos compartidos ────────────────────────────────────────────────────────

export interface TrafficSpan {
  startIndex: number
  endIndex:   number
  congestion: number
  speedKmh:   number | null
}

interface RouteResult {
  geometry:         [number, number][]
  snappedWaypoints: [number, number][]
  distanceKm:       number | null
  durationSeconds:  number | null
  trafficSpans:     TrafficSpan[]
  description?:     string
  hasTolls?:        boolean
}

interface CalcInput {
  waypoints:        [number, number][]
  travelMode:       RouteTravelMode
  avoidTolls?:      boolean
  avoidFerries?:    boolean
  departureTime?:   Date
  maxAlternatives?: number
}

// ─── Google Routes API ────────────────────────────────────────────────────────

const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

function decodeGooglePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0; result = 0
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    coords.push([lng / 1e5, lat / 1e5])
  }
  return coords
}

async function callGoogleRoutes(input: CalcInput): Promise<RouteResult[]> {
  const origin      = input.waypoints[0]
  const destination = input.waypoints[input.waypoints.length - 1]
  const avoidTolls  = input.avoidTolls ?? false
  const maxAlts     = Math.min((input.maxAlternatives ?? 3) - 1, 2)

  const body: any = {
    origin:      { location: { latLng: { latitude: origin[1],      longitude: origin[0] } } },
    destination: { location: { latLng: { latitude: destination[1], longitude: destination[0] } } },
    travelMode:  input.travelMode === 'Walking' ? 'WALK' : 'DRIVE',
    routingPreference:        'TRAFFIC_AWARE_OPTIMAL',
    computeAlternativeRoutes: maxAlts > 0,
    routeModifiers:  { avoidTolls, avoidFerries: input.avoidFerries ?? false },
    departureTime:   (input.departureTime ?? new Date()).toISOString(),
  }

  if (input.waypoints.length > 2) {
    body.intermediates = input.waypoints.slice(1, -1).map(([lng, lat]) => ({
      location: { latLng: { latitude: lat, longitude: lng } },
    }))
  }

  const resp = await fetch(GOOGLE_ROUTES_URL, {
    method:  'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   GOOGLE_MAPS_API_KEY!,
      'X-Goog-FieldMask': [
        'routes.duration',
        'routes.distanceMeters',
        'routes.description',
        'routes.warnings',
        'routes.polyline.encodedPolyline',
        'routes.travelAdvisory.speedReadingIntervals',
      ].join(','),
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Google Routes API error ${resp.status}: ${text}`)
  }

  const data: any        = await resp.json()
  const routes: any[]    = data.routes ?? []
  if (!routes.length) return []

  return routes.map((route: any) => {
    const durationSecs = route.duration ? parseInt(route.duration.replace('s', ''), 10) : null
    const distanceKm   = route.distanceMeters ? route.distanceMeters / 1000 : null
    const hasTolls     = !!(route.warnings ?? []).some(
      (w: string) => w.toLowerCase().includes('peaje') || w.toLowerCase().includes('toll')
    )

    let geometry: [number, number][] = []
    if (route.polyline?.encodedPolyline) {
      geometry = decodeGooglePolyline(route.polyline.encodedPolyline)
    }

    const snappedWaypoints: [number, number][] = geometry.length >= 2
      ? [geometry[0], geometry[geometry.length - 1]]
      : [origin, destination]

    // Traffic spans desde speedReadingIntervals
    const trafficSpans: TrafficSpan[] = []
    const intervals: any[] = route.travelAdvisory?.speedReadingIntervals ?? []
    for (const interval of intervals) {
      const startIdx = interval.startPolylinePointIndex ?? 0
      const endIdx   = interval.endPolylinePointIndex   ?? 0
      if (startIdx >= endIdx) continue
      const speed      = interval.speed ?? 'NORMAL'
      const congestion = speed === 'TRAFFIC_JAM' ? 1.0 : speed === 'SLOW' ? 0.55 : 0.1
      trafficSpans.push({ startIndex: startIdx, endIndex: endIdx, congestion, speedKmh: null })
    }

    return { geometry, snappedWaypoints, distanceKm, durationSeconds: durationSecs, trafficSpans, description: route.description, hasTolls }
  })
}

// ─── AWS Routes API ───────────────────────────────────────────────────────────

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

function extractTrafficSpans(legs: any[], geometry: [number, number][]): TrafficSpan[] {
  if (!legs?.length || !geometry.length) return []
  const spans: TrafficSpan[] = []
  let geoOffset = 0
  for (const leg of legs) {
    const legCoords: any[] = leg.Geometry?.LineString ?? []
    const legSpans: any[]  = leg.Spans ?? []
    for (let si = 0; si < legSpans.length; si++) {
      const span        = legSpans[si]
      const nextSpan    = legSpans[si + 1]
      const startInLeg  = span.GeometryOffset ?? 0
      const endInLeg    = nextSpan?.GeometryOffset ?? (legCoords.length - 1)
      const globalStart = geoOffset + startInLeg
      const globalEnd   = Math.min(geoOffset + endInLeg, geometry.length - 1)
      const duration        = span.Duration        ?? null
      const typicalDuration = span.TypicalDuration ?? null
      let congestion = 0
      if (duration != null && typicalDuration != null && typicalDuration > 0) {
        congestion = Math.min(1, Math.max(0, (duration - typicalDuration) / typicalDuration / 0.6))
      }
      const speedKmh = span.SpeedLimit?.MaxSpeed ?? null
      if (globalStart < globalEnd) spans.push({ startIndex: globalStart, endIndex: globalEnd, congestion, speedKmh })
    }
    geoOffset += Math.max(0, legCoords.length - 1)
  }
  return spans
}

async function callAWSRoutes(input: CalcInput): Promise<RouteResult[]> {
  const mode         = toGeoRoutesMode(input.travelMode)
  const avoidFerries = input.avoidFerries ?? true
  const avoidTolls   = input.avoidTolls   ?? false
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
    SpanAdditionalFeatures: ['Duration', 'TypicalDuration', 'SpeedLimit', 'Incidents', 'DynamicSpeed'] as any,
    Traffic: { Usage: 'UseTrafficData' } as any,
    ...(mode === 'Car'   ? { CarOptions:   { AvoidFerries: avoidFerries, AvoidTolls: avoidTolls } } : {}),
    ...(mode === 'Truck' ? { TruckOptions: { AvoidFerries: avoidFerries, AvoidTolls: avoidTolls } } : {}),
  }))

  const routes = resp.Routes ?? []
  if (!routes.length) return []

  return routes.map((route: any) => {
    const legs     = route.Legs ?? []
    const summary  = route.Summary
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

// ─── Dispatcher ──────────────────────────────────────────────────────────────

async function calcRoutes(input: CalcInput): Promise<RouteResult[]> {
  return USE_GOOGLE ? callGoogleRoutes(input) : callAWSRoutes(input)
}

function isNoRouteError(err: any): boolean {
  const msg = String(err?.message ?? '')
  return (
    String(err?.name ?? '').includes('RouteNotFoundException') ||
    msg.includes('No route found') || msg.includes('cannot be reached') ||
    msg.includes('Route cannot be calculated') || msg.includes('ZERO_RESULTS')
  )
}

// ─── Express routes ───────────────────────────────────────────────────────────

export function registerRouteRoutes(app: Express): void {

  app.get('/api/routes', async (_req, res) => {
    try { res.json(await listRoutes()) }
    catch (err) { sendError(res, err) }
  })

  app.post('/api/routes/calculate', async (req, res) => {
    try {
      const waypoints = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) { res.status(400).json({ message: 'At least 2 waypoints are required' }); return }
      const travelMode      = parseTravelMode(req.body?.travelMode) ?? 'Car'
      const avoidTolls      = req.body?.avoidTolls === true
      const maxAlternatives = Math.min(Math.max(Number(req.body?.alternatives ?? 3), 1), 3)

      let results: RouteResult[]
      try {
        results = await calcRoutes({ waypoints, travelMode, avoidTolls, avoidFerries: true, departureTime: new Date(), maxAlternatives })
      } catch (awsErr) {
        if (isNoRouteError(awsErr)) { res.status(422).json({ message: 'No se encontró ruta entre los puntos seleccionados.', code: 'NO_ROUTE' }); return }
        throw awsErr
      }

      if (!results.length) { res.status(422).json({ message: 'No se encontró ruta', code: 'NO_ROUTE' }); return }

      const [main, ...alts] = results
      res.json({
        geometry:         main.geometry,
        distance:         main.distanceKm,
        durationSeconds:  main.durationSeconds,
        trafficSpans:     main.trafficSpans,
        description:      main.description,
        travelMode,
        departureTime:    new Date().toISOString(),
        snappedWaypoints: main.snappedWaypoints,
        provider:         USE_GOOGLE ? 'google' : 'aws',
        alternatives: alts.map(a => ({
          geometry:         a.geometry,
          distance:         a.distanceKm,
          durationSeconds:  a.durationSeconds,
          trafficSpans:     a.trafficSpans,
          description:      a.description,
          snappedWaypoints: a.snappedWaypoints,
        })),
      })
    } catch (err) { sendError(res, err) }
  })

  app.post('/api/routes/debug', async (req, res) => {
    try {
      const waypoints = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) { res.status(400).json({ message: 'Need 2 waypoints' }); return }
      const results = await calcRoutes({ waypoints, travelMode: 'Car', maxAlternatives: 3, departureTime: new Date() })
      res.json({
        provider:   USE_GOOGLE ? 'google' : 'aws',
        routeCount: results.length,
        routes: results.map((r, i) => ({
          index:       i,
          durationMin: r.durationSeconds ? Math.round(r.durationSeconds / 60) : null,
          distanceKm:  r.distanceKm,
          spanCount:   r.trafficSpans.length,
          description: r.description,
        })),
      })
    } catch (err) { sendError(res, err) }
  })

  app.put('/api/routes/:routeId', async (req, res) => {
    try {
      const { routeId } = req.params
      const waypoints   = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) { res.status(400).json({ message: 'At least 2 waypoints are required' }); return }
      const travelMode = parseTravelMode(req.body?.travelMode)
      if (!travelMode) { res.status(400).json({ message: 'travelMode must be one of Car, Truck or Walking' }); return }

      let results: RouteResult[]
      try {
        results = await calcRoutes({ waypoints, travelMode, avoidFerries: true, departureTime: new Date(), maxAlternatives: 1 })
      } catch (awsErr) {
        if (isNoRouteError(awsErr)) { res.status(422).json({ message: 'No se encontró ruta', code: 'NO_ROUTE' }); return }
        throw awsErr
      }

      if (!results.length) { res.status(422).json({ message: 'No se encontró ruta', code: 'NO_ROUTE' }); return }

      const main     = results[0]
      const now      = new Date().toISOString()
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
