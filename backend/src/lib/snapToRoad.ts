import { SearchPlaceIndexForPositionCommand } from '@aws-sdk/client-location'
import { locationClient, ROUTE_CALCULATOR } from './locationClient'

// ─── Configuración de umbral ─────────────────────────────────────────────────
// Distancia máxima en metros para aplicar snap.
// Si el GPS está más lejos que esto de cualquier vía, se asume zona especial
// (cochera, punto de carga, patio) y se deja la coordenada GPS original.
const SNAP_MAX_DISTANCE_M = 35

// Velocidad mínima en km/h para aplicar snap.
// Por debajo de esto el vehículo está maniobrando — no se toca la posición.
const SNAP_MIN_SPEED_KMH = 8

// Velocidad a partir de la cual snap es seguro aplicar con umbral normal.
// Entre MIN y FULL se usa un umbral más conservador (mitad de distancia).
const SNAP_FULL_SPEED_KMH = 15

// ─── Haversine: distancia en metros entre dos puntos ────────────────────────
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6_371_000
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Snap-to-road principal ──────────────────────────────────────────────────
// Devuelve la posición corregida (o la original si no aplica snap).
// Nunca lanza — en caso de error retorna la posición original para no bloquear.
export async function snapToRoad(
  lat: number,
  lng: number,
  speedKmh: number | null,
): Promise<{ lat: number; lng: number; snapped: boolean }> {

  // Sin ROUTE_CALCULATOR configurado → no hacer nada
  if (!ROUTE_CALCULATOR) return { lat, lng, snapped: false }

  // Vehículo lento o detenido → probablemente en cochera o patio, no tocar
  const speed = speedKmh ?? 0
  if (speed < SNAP_MIN_SPEED_KMH) return { lat, lng, snapped: false }

  // Umbral dinámico: más conservador a velocidades intermedias
  const threshold = speed < SNAP_FULL_SPEED_KMH
    ? SNAP_MAX_DISTANCE_M / 2
    : SNAP_MAX_DISTANCE_M

  try {
    // Usamos SearchPlaceIndexForPosition para encontrar la vía más cercana.
    // AWS Location no tiene SnapToRoads directo en el SDK v3, pero podemos
    // aprovechar el índice de lugares para obtener la posición en vía más próxima.
    // Para snap real usamos CalculateRoute con origen = destino = punto GPS,
    // que devuelve el punto snapped a la red vial.
    const { locationClient: client } = await import('./locationClient')

    // Estrategia: calcular ruta de 1 metro desde el punto hacia sí mismo.
    // AWS Location internamente snapea ambos extremos a la vía más cercana.
    const { CalculateRouteCommand } = await import('@aws-sdk/client-location')
    const result = await locationClient.send(new CalculateRouteCommand({
      CalculatorName: ROUTE_CALCULATOR,
      DeparturePosition:   [lng, lat],
      DestinationPosition: [lng + 0.00001, lat + 0.00001], // desplazamiento mínimo (~1m)
      TravelMode: 'Car',
      IncludeLegGeometry: true,
    }))

    const firstPoint = result.Legs?.[0]?.Geometry?.LineString?.[0]
    if (!firstPoint || firstPoint.length < 2) return { lat, lng, snapped: false }

    const snappedLng = firstPoint[0]
    const snappedLat = firstPoint[1]

    // Verificar distancia entre GPS original y punto snapped
    const distM = haversineM(lat, lng, snappedLat, snappedLng)

    // Si está demasiado lejos del road → zona especial, respetar GPS original
    if (distM > threshold) {
      return { lat, lng, snapped: false }
    }

    return { lat: snappedLat, lng: snappedLng, snapped: true }

  } catch {
    // Cualquier error (timeout, rate limit, etc.) → posición original
    return { lat, lng, snapped: false }
  }
}
