import { LocationClient } from '@aws-sdk/client-location'

export const locationClient = new LocationClient({
  region: process.env.AWS_REGION ?? 'sa-east-1',
})

export const GEOFENCE_COLLECTION = process.env.GEOFENCE_COLLECTION ?? 'armadillo-geofences'
export const ROUTE_CALCULATOR    = process.env.ROUTE_CALCULATOR
export const PLACE_INDEX         = process.env.PLACE_INDEX
