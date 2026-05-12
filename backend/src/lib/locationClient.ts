import { LocationClient } from '@aws-sdk/client-location'
import { GeoRoutesClient } from '@aws-sdk/client-geo-routes'
import { GeoPlacesClient } from '@aws-sdk/client-geo-places'

const REGION = process.env.AWS_REGION ?? 'sa-east-1'

export const geoRoutesClient = new GeoRoutesClient({ region: REGION })
export const geoPlacesClient = new GeoPlacesClient({ region: REGION })
export const locationClient  = new LocationClient({ region: REGION })

export const GEOFENCE_COLLECTION = process.env.GEOFENCE_COLLECTION ?? 'armadillo-geofences'
export const ROUTE_CALCULATOR    = process.env.ROUTE_CALCULATOR
export const PLACE_INDEX         = process.env.PLACE_INDEX

// Si existe GOOGLE_MAPS_API_KEY, se usa Google para rutas y places
export const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? null
export const USE_GOOGLE          = !!GOOGLE_MAPS_API_KEY
