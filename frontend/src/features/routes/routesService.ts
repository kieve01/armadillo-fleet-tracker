import { HttpRequestError, requestJson, requestVoid } from '../../lib/httpClient'
import type { RouteResource, RouteTravelMode } from './types'

const BASE = import.meta.env.VITE_API_BASE_URL

interface PutRoutePayload {
  waypoints: [number, number][]
  travelMode: RouteTravelMode
}

export interface CalculateRoutePayload {
  waypoints:     [number, number][]
  travelMode:    RouteTravelMode
  avoidTolls?:   boolean
  departureTime?: string  // ISO string — activa tráfico histórico
}

export interface CalculateRouteResult {
  geometry:        [number, number][]
  distance:        number | null
  durationSeconds: number | null
  travelMode:      RouteTravelMode
  departureTime:   string
  snappedWaypoints: [number, number][]
}

function toError(error: unknown): Error {
  if (error instanceof HttpRequestError) {
    // Parsear el mensaje de error de AWS que viene en el body
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
  try {
    return await requestJson<RouteResource[]>(`${BASE}/api/routes`, { retries: 2 })
  } catch (error) {
    throw toError(error)
  }
}

export async function calculateRoute(payload: CalculateRoutePayload): Promise<CalculateRouteResult> {
  try {
    return await requestJson<CalculateRouteResult>(`${BASE}/api/routes/calculate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw toError(error)
  }
}

export async function putRoute(routeId: string, payload: PutRoutePayload): Promise<RouteResource> {
  try {
    return await requestJson<RouteResource>(`${BASE}/api/routes/${encodeURIComponent(routeId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw toError(error)
  }
}

export async function deleteRoute(routeId: string): Promise<void> {
  try {
    await requestVoid(`${BASE}/api/routes/${encodeURIComponent(routeId)}`, { method: 'DELETE' })
  } catch (error) {
    throw toError(error)
  }
}
