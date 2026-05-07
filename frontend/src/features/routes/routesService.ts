import { HttpRequestError, requestJson, requestVoid } from '../../lib/httpClient'
import type { RouteResource, RouteTravelMode } from './types'

const BASE = import.meta.env.VITE_API_BASE_URL

interface PutRoutePayload {
  waypoints: [number, number][]
  travelMode: RouteTravelMode
}

function toError(error: unknown): Error {
  if (error instanceof HttpRequestError) {
    const detail = error.body ? `: ${error.body}` : ''
    return new Error(`Request failed (${error.status})${detail}`)
  }

  return error instanceof Error ? error : new Error('Unknown API error')
}

export async function listRoutes(): Promise<RouteResource[]> {
  try {
    return await requestJson<RouteResource[]>(`${BASE}/api/routes`, { retries: 2 })
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
    await requestVoid(`${BASE}/api/routes/${encodeURIComponent(routeId)}`, {
      method: 'DELETE',
    })
  } catch (error) {
    throw toError(error)
  }
}