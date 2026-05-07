export interface GeofencePolygonGeometry {
  Polygon: number[][][]
}

export interface GeofenceCircleGeometry {
  Circle: { Center: [number, number]; Radius: number }
}

export type GeofenceGeometry = GeofencePolygonGeometry | GeofenceCircleGeometry

export interface Geofence {
  GeofenceId: string
  Geometry: GeofenceGeometry
  Status: 'Active' | 'Deleted'
}

export type DrawMode = 'polygon' | 'circle'

export interface GeofenceDraft {
  geofenceId: string
  mode: DrawMode
  drawnFeature: GeoJSON.Feature | null
}

export interface ApiError extends Error {
  status: number
}

export function makeApiError(status: number, message: string): ApiError {
  const err = new Error(message) as ApiError
  err.status = status
  return err
}
