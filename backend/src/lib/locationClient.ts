import { LocationClient } from '@aws-sdk/client-location'
import { GeoRoutesClient } from '@aws-sdk/client-geo-routes'
import { GeoPlacesClient }  from '@aws-sdk/client-geo-places'

const REGION = process.env.AWS_REGION ?? 'sa-east-1'

// Clientes v2 — para rutas y places
export const geoRoutesClient = new GeoRoutesClient({ region: REGION })
export const geoPlacesClient = new GeoPlacesClient({ region: REGION })

// Cliente v1 — sólo para geofences y trackers (todavía no migrados)
export const locationClient = new LocationClient({ region: REGION })

export const GEOFENCE_COLLECTION = process.env.GEOFENCE_COLLECTION ?? 'armadillo-geofences'
// ROUTE_CALCULATOR ya no se usa con la API v2 — se conserva para referencia
export const ROUTE_CALCULATOR    = process.env.ROUTE_CALCULATOR
export const PLACE_INDEX         = process.env.PLACE_INDEX
