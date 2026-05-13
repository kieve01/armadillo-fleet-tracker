import type { Express } from 'express'
import { CalculateRoutesCommand } from '@aws-sdk/client-geo-routes'
import { geoRoutesClient, GOOGLE_MAPS_API_KEY, USE_GOOGLE } from '../../lib/locationClient'
import {
  deleteRoute, getRoute, listRoutes, putRoute,
  type RouteRecord, type RouteTravelMode,
} from '../../lib/routesStore'
import { sendError } from '../../http/sendError'

export interface TrafficSpan {
  startIndex: number
  endIndex:   number
  congestion: number
  speedKmh:   number | null
}

interface RouteResult {
  geometry:               [number, number][]
  snappedWaypoints:       [number, number][]
  distanceKm:             number | null
  durationSeconds:        number | null
  staticDurationSeconds:  number | null   // sin tráfico — para mostrar el delta
  trafficSpans:           TrafficSpan[]
  description?:           string
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

function decodePolyline(encoded: string): [number, number][] {
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
  const maxAlts     = Math.min((input.maxAlternatives ?? 3) - 1, 2)

  const body: any = {
    origin:      { location: { latLng: { latitude: origin[1],      longitude: origin[0] } } },
    destination: { location: { latLng: { latitude: destination[1], longitude: destination[0] } } },
    travelMode:              input.travelMode === 'Walking' ? 'WALK' : 'DRIVE',
    routingPreference:       'TRAFFIC_AWARE_OPTIMAL',
    computeAlternativeRoutes: maxAlts > 0,
    extraComputations:       ['TRAFFIC_ON_POLYLINE'],
    polylineQuality:         'HIGH_QUALITY',
    routeModifiers: {
      avoidTolls:   input.avoidTolls   ?? false,
      avoidFerries: input.avoidFerries ?? false,
    },
  }

  if (input.waypoints.length > 2) {
    body.intermediates = input.waypoints.slice(1, -1).map(([lng, lat]) => ({
      location: { latLng: { latitude: lat, longitude: lng } },
    }))
  }

  const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method:  'POST',
    headers: {
      'Content-Type':   'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY!,
      // staticDuration = tiempo sin tráfico; duration = con tráfico
      // speedReadingIntervals = segmentos coloreados (solo si hay variación)
      'X-Goog-FieldMask': [
        'routes.duration',
        'routes.staticDuration',
        'routes.distanceMeters',
        'routes.description',
        'routes.polyline.encodedPolyline',
        'routes.travelAdvisory.speedReadingIntervals',
      ].join(','),
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Google Routes error ${resp.status}: ${text}`)
  }

  const data: any     = await resp.json()
  const routes: any[] = data.routes ?? []
  if (!routes.length) return []

  return routes.map((route: any) => {
    const parseSecs = (s: string | undefined) =>
      s ? parseInt(s.replace('s', ''), 10) : null

    const durationSecs       = parseSecs(route.duration)
    const staticDurationSecs = parseSecs(route.staticDuration)
    const distanceKm         = route.distanceMeters ? route.distanceMeters / 1000 : null

    const geometry: [number, number][] = route.polyline?.encodedPolyline
      ? decodePolyline(route.polyline.encodedPolyline)
      : []

    const snappedWaypoints: [number, number][] = geometry.length >= 2
      ? [geometry[0], geometry[geometry.length - 1]]
      : [origin, destination]

    // speedReadingIntervals: solo presente cuando hay segmentos SLOW o TRAFFIC_JAM
    // Si todo está NORMAL → array vacío (pero duration > staticDuration igual)
    const trafficSpans: TrafficSpan[] = []
    const intervals: any[] = route.travelAdvisory?.speedReadingIntervals ?? []
    for (const interval of intervals) {
      const startIdx = interval.startPolylinePointIndex ?? 0
      const endIdx   = interval.endPolylinePointIndex   ?? 0
      if (endIdx <= startIdx) continue
      const speed = interval.speed ?? 'NORMAL'
      trafficSpans.push({
        startIndex: startIdx,
        endIndex:   endIdx,
        congestion: speed === 'TRAFFIC_JAM' ? 1.0 : speed === 'SLOW' ? 0.55 : 0.1,
        speedKmh:   null,
      })
    }

    return {
      geometry,
      snappedWaypoints,
      distanceKm,
      durationSeconds:       durationSecs,
      staticDurationSeconds: staticDurationSecs,
      trafficSpans,
      description:           route.description,
    }
  })
}

// ─── AWS fallback ─────────────────────────────────────────────────────────────

type GeoRoutesMode = 'Car' | 'Truck' | 'Pedestrian'
function toAWSMode(mode: RouteTravelMode): GeoRoutesMode {
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

async function callAWSRoutes(input: CalcInput): Promise<RouteResult[]> {
  const mode      = toAWSMode(input.travelMode)
  const extraAlts = Math.min((input.maxAlternatives ?? 3) - 1, 2)
  const resp = await geoRoutesClient.send(new CalculateRoutesCommand({
    Origin:            input.waypoints[0],
    Destination:       input.waypoints[input.waypoints.length - 1],
    TravelMode:        mode,
    DepartureTime:     (input.departureTime ?? new Date()).toISOString(),
    LegGeometryFormat: 'Simple',
    ...(extraAlts > 0 ? { MaxAlternatives: extraAlts } : {}),
    SpanAdditionalFeatures: ['Duration', 'TypicalDuration', 'SpeedLimit'] as any,
    ...(mode === 'Car'   ? { CarOptions:   { AvoidFerries: true, AvoidTolls: input.avoidTolls ?? false } } : {}),
    ...(mode === 'Truck' ? { TruckOptions: { AvoidFerries: true, AvoidTolls: input.avoidTolls ?? false } } : {}),
  }))
  return (resp.Routes ?? []).map((route: any) => {
    const legs = route.Legs ?? []
    return {
      geometry:               extractGeometry(legs),
      snappedWaypoints:       extractSnappedWaypoints(legs, input.waypoints),
      distanceKm:             route.Summary?.Distance != null ? route.Summary.Distance / 1000 : null,
      durationSeconds:        route.Summary?.Duration ?? null,
      staticDurationSeconds:  null,
      trafficSpans:           [],
    }
  })
}

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

// ─── Express ──────────────────────────────────────────────────────────────────

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
        results = await calcRoutes({ waypoints, travelMode, avoidTolls, avoidFerries: false, departureTime: new Date(), maxAlternatives })
      } catch (err) {
        if (isNoRouteError(err)) { res.status(422).json({ message: 'No se encontró ruta entre los puntos seleccionados.', code: 'NO_ROUTE' }); return }
        throw err
      }
      if (!results.length) { res.status(422).json({ message: 'No se encontró ruta', code: 'NO_ROUTE' }); return }

      const [main, ...alts] = results
      res.json({
        geometry:               main.geometry,
        distance:               main.distanceKm,
        durationSeconds:        main.durationSeconds,
        staticDurationSeconds:  main.staticDurationSeconds,
        trafficSpans:           main.trafficSpans,
        description:            main.description,
        travelMode,
        departureTime:          new Date().toISOString(),
        snappedWaypoints:       main.snappedWaypoints,
        provider:               USE_GOOGLE ? 'google' : 'aws',
        alternatives: alts.map(a => ({
          geometry:               a.geometry,
          distance:               a.distanceKm,
          durationSeconds:        a.durationSeconds,
          staticDurationSeconds:  a.staticDurationSeconds,
          trafficSpans:           a.trafficSpans,
          description:            a.description,
          snappedWaypoints:       a.snappedWaypoints,
        })),
      })
    } catch (err) { sendError(res, err) }
  })

  app.post('/api/routes/debug', async (req, res) => {
    try {
      const waypoints = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) { res.status(400).json({ message: 'Need 2 waypoints' }); return }

      if (!USE_GOOGLE) {
        const results = await calcRoutes({ waypoints, travelMode: 'Car', maxAlternatives: 3, departureTime: new Date() })
        res.json({ provider: 'aws', routeCount: results.length, routes: results.map((r, i) => ({ index: i, durationMin: r.durationSeconds ? Math.round(r.durationSeconds / 60) : null, distanceKm: r.distanceKm, spanCount: r.trafficSpans.length })) })
        return
      }

      const origin = waypoints[0], destination = waypoints[1]
      const googleResp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-Goog-Api-Key':   GOOGLE_MAPS_API_KEY!,
          'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.description,routes.polyline.encodedPolyline,routes.travelAdvisory.speedReadingIntervals',
        },
        body: JSON.stringify({
          origin:      { location: { latLng: { latitude: origin[1],      longitude: origin[0] } } },
          destination: { location: { latLng: { latitude: destination[1], longitude: destination[0] } } },
          travelMode:              'DRIVE',
          routingPreference:       'TRAFFIC_AWARE_OPTIMAL',
          computeAlternativeRoutes: true,
          extraComputations:       ['TRAFFIC_ON_POLYLINE'],
    polylineQuality:         'HIGH_QUALITY',
        }),
      })
      const data: any = await googleResp.json()
      const parseSecs = (s: string | undefined) => s ? parseInt(s.replace('s', ''), 10) : null

      res.json({
        provider:   'google',
        httpStatus: googleResp.status,
        error:      data.error ?? null,
        routeCount: (data.routes ?? []).length,
        routes: (data.routes ?? []).map((r: any, i: number) => {
          const dur    = parseSecs(r.duration)
          const static_ = parseSecs(r.staticDuration)
          const delta  = dur != null && static_ != null ? dur - static_ : null
          return {
            index:             i,
            durationMin:       dur    ? Math.round(dur    / 60) : null,
            staticDurationMin: static_ ? Math.round(static_ / 60) : null,
            trafficDelayMin:   delta  ? Math.round(delta  / 60) : 0,
            trafficWorking:    delta != null && delta > 0,
            distanceKm:        r.distanceMeters ? r.distanceMeters / 1000 : null,
            description:       r.description,
            spanCount:         (r.travelAdvisory?.speedReadingIntervals ?? []).length,
            sampleSpans:       (r.travelAdvisory?.speedReadingIntervals ?? []).slice(0, 3),
            polylinePoints:    r.polyline?.encodedPolyline ? decodePolyline(r.polyline.encodedPolyline).length : 0,
          }
        }),
      })
    } catch (err) { sendError(res, err) }
  })

  app.put('/api/routes/:routeId', async (req, res) => {
    try {
      const { routeId } = req.params
      const waypoints   = parseWaypoints(req.body?.waypoints)
      if (waypoints.length < 2) { res.status(400).json({ message: 'At least 2 waypoints are required' }); return }
      const travelMode = parseTravelMode(req.body?.travelMode)
      if (!travelMode) { res.status(400).json({ message: 'travelMode must be Car, Truck or Walking' }); return }

      let results: RouteResult[]
      try {
        results = await calcRoutes({ waypoints, travelMode, avoidFerries: false, departureTime: new Date(), maxAlternatives: 1 })
      } catch (err) {
        if (isNoRouteError(err)) { res.status(422).json({ message: 'No se encontró ruta', code: 'NO_ROUTE' }); return }
        throw err
      }
      if (!results.length) { res.status(422).json({ message: 'No se encontró ruta', code: 'NO_ROUTE' }); return }

      const main = results[0], now = new Date().toISOString()
      const existing = await getRoute(routeId)
      await putRoute({ routeId, waypoints, geometry: main.geometry, travelMode, distance: main.distanceKm, durationSeconds: main.durationSeconds, createdAt: existing?.createdAt ?? now, updatedAt: now })
      res.json({ routeId, geometry: main.geometry, travelMode, distance: main.distanceKm, durationSeconds: main.durationSeconds })
    } catch (err) { sendError(res, err) }
  })

  app.delete('/api/routes/:routeId', async (req, res) => {
    try { await deleteRoute(req.params.routeId); res.sendStatus(204) }
    catch (err) { sendError(res, err) }
  })
}

function parseWaypoints(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return []
  return value.filter(p =>
    Array.isArray(p) && p.length === 2 &&
    typeof p[0] === 'number' && Number.isFinite(p[0]) &&
    typeof p[1] === 'number' && Number.isFinite(p[1])
  ) as [number, number][]
}

function parseTravelMode(value: unknown): RouteTravelMode | null {
  if (value === 'Car' || value === 'Truck' || value === 'Walking') return value
  if (value == null) return 'Car'
  return null
}
