import { HttpRequestError, requestJson, requestVoid } from '../../lib/httpClient'
import type { RouteResource, RouteTravelMode } from './types'

const BASE = import.meta.env.VITE_API_BASE_URL

interface PutRoutePayload {
  waypoints:  [number, number][]
  travelMode: RouteTravelMode
}

export interface CalculateRoutePayload {
  waypoints:     [number, number][]
  travelMode:    RouteTravelMode
  avoidTolls?:   boolean
  alternatives?: number
}

export interface TrafficSpan {
  startIndex: number
  endIndex:   number
  congestion: number   // 0=verde 0.5=amarillo 1=rojo
  speedKmh:   number | null
}

export interface RouteAlternative {
  geometry:         [number, number][]
  distance:         number | null
  durationSeconds:  number | null
  trafficSpans:     TrafficSpan[]
  snappedWaypoints: [number, number][]
}

export interface CalculateRouteResult {
  geometry:         [number, number][]
  distance:         number | null
  durationSeconds:  number | null
  trafficSpans:     TrafficSpan[]
  travelMode:       RouteTravelMode
  departureTime:    string
  snappedWaypoints: [number, number][]
  alternatives:     RouteAlternative[]
}

function toError(error: unknown): Error {
  if (error instanceof HttpRequestError) {
    try {
      const body = JSON.parse(error.body ?? '{}') as { message?: string; code?: string }
      if (body.code === 'NO_ROUTE') {
        const err = new Error(body.message ?? 'No se encontró ruta')
        ;(err as any).code = 'NO_ROUTE'
        return err
      }
      if (body.message) return new Error(body.message)
    } catch {}
    return new Error(`Error de servidor (${error.status})`)
  }
  return error instanceof Error ? error : new Error('Error desconocido')
}

export async function listRoutes(): Promise<RouteResource[]> {
  try { return await requestJson<RouteResource[]>(`${BASE}/api/routes`, { retries: 2 }) }
  catch (error) { throw toError(error) }
}

export async function calculateRoute(payload: CalculateRoutePayload): Promise<CalculateRouteResult> {
  try {
    return await requestJson<CalculateRouteResult>(`${BASE}/api/routes/calculate`, {
      method: 'POST',
      body: JSON.stringify({ ...payload, alternatives: payload.alternatives ?? 3 }),
    })
  } catch (error) { throw toError(error) }
}

export async function putRoute(routeId: string, payload: PutRoutePayload): Promise<RouteResource> {
  try {
    return await requestJson<RouteResource>(`${BASE}/api/routes/${encodeURIComponent(routeId)}`, {
      method: 'PUT', body: JSON.stringify(payload),
    })
  } catch (error) { throw toError(error) }
}

export async function deleteRoute(routeId: string): Promise<void> {
  try { await requestVoid(`${BASE}/api/routes/${encodeURIComponent(routeId)}`, { method: 'DELETE' }) }
  catch (error) { throw toError(error) }
}

// Resolver placeId exacto (viene del autocompletado)
export async function resolvePlaceId(placeId: string): Promise<{ label: string; point: [number, number] } | null> {
  try {
    const r = await fetch(`${BASE}/api/places/resolve-id?id=${encodeURIComponent(placeId)}`)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}
