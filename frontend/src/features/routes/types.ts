export type RouteTravelMode = 'Car' | 'Truck' | 'Walking'

export interface RouteResource {
  routeId: string
  waypoints: [number, number][]
  geometry: [number, number][]
  travelMode: RouteTravelMode
  distance: number | null
  durationSeconds: number | null
  createdAt: string
  updatedAt: string
}