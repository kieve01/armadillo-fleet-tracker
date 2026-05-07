import { makeApiError, type Geofence, type GeofenceGeometry } from './types'
import { requestJson, requestVoid, HttpRequestError } from '../../lib/httpClient'

const BASE = import.meta.env.VITE_API_BASE_URL

function toApiError(error: unknown): Error {
  if (error instanceof HttpRequestError) {
    return makeApiError(error.status, error.body || `HTTP ${error.status}`)
  }
  return error instanceof Error ? error : new Error('Unknown API error')
}

export async function listGeofences(): Promise<Geofence[]> {
  try {
    return await requestJson<Geofence[]>(`${BASE}/api/geofences`, { retries: 2 })
  } catch (error) {
    throw toApiError(error)
  }
}

export async function putGeofence(geofenceId: string, geometry: GeofenceGeometry): Promise<void> {
  try {
    await requestVoid(`${BASE}/api/geofences/${encodeURIComponent(geofenceId)}`, {
      method: 'PUT',
      body: JSON.stringify({ Geometry: geometry }),
    })
  } catch (error) {
    throw toApiError(error)
  }
}

export async function deleteGeofence(geofenceId: string): Promise<void> {
  try {
    await requestVoid(`${BASE}/api/geofences/${encodeURIComponent(geofenceId)}`, {
      method: 'DELETE',
    })
  } catch (error) {
    throw toApiError(error)
  }
}
