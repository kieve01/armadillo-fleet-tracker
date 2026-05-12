import { SnapToRoadsCommand } from '@aws-sdk/client-geo-routes'
import { geoRoutesClient } from './locationClient'

// ─── Configuración de umbral ─────────────────────────────────────────────────
const SNAP_MAX_DISTANCE_M  = 35
const SNAP_MIN_SPEED_KMH   = 8
const SNAP_FULL_SPEED_KMH  = 15

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6_371_000
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Snap-to-road usando la API v2 (SnapToRoads).
 * La v2 tiene un endpoint dedicado — mucho más directo y preciso que el hack
 * de CalculateRoute con desplazamiento de 1m que usábamos con la v1.
 * Nunca lanza: en caso de error retorna la posición original.
 */
export async function snapToRoad(
  lat: number,
  lng: number,
  speedKmh: number | null,
): Promise<{ lat: number; lng: number; snapped: boolean }> {

  const speed = speedKmh ?? 0
  if (speed < SNAP_MIN_SPEED_KMH) return { lat, lng, snapped: false }

  const threshold = speed < SNAP_FULL_SPEED_KMH
    ? SNAP_MAX_DISTANCE_M / 2
    : SNAP_MAX_DISTANCE_M

  try {
    const resp = await geoRoutesClient.send(new SnapToRoadsCommand({
      TracePoints: [{ Position: [lng, lat] }],
      TravelMode:  'Car',
      // Desactivamos SnapRadius explícito — dejamos el default de la API (50m)
      // y luego filtramos nosotros con threshold más conservador
    }))

    const snappedPt = resp.Notices?.[0]?.TracePointIndexes != null
      ? null  // punto rechazado por la API (fuera de red vial)
      : resp.SnappedGeometry?.LineString?.[0]

    if (!snappedPt || !Array.isArray(snappedPt) || snappedPt.length < 2) {
      return { lat, lng, snapped: false }
    }

    const [snappedLng, snappedLat] = snappedPt
    const distM = haversineM(lat, lng, snappedLat, snappedLng)

    if (distM > threshold) return { lat, lng, snapped: false }

    return { lat: snappedLat, lng: snappedLng, snapped: true }
  } catch {
    return { lat, lng, snapped: false }
  }
}
