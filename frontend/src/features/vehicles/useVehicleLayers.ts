import { useEffect, useRef, useCallback } from 'react'
import type { Map as MLMap, GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import { useMapStore } from '../../store/mapStore'
import { useVehiclesStore } from './vehiclesStore'
import type { Device } from './types'

const SOURCE_ID    = 'trackers-source'
const CIRCLE_LAYER = 'trackers-circle'
const LABEL_LAYER  = 'trackers-label'
const ARROW_LAYER  = 'trackers-arrow'

// ─── Kalman filter 1D ────────────────────────────────────────────────────────
class KalmanFilter {
  private R: number; private Q: number
  private x = 0; private P = 1; private k = 0
  constructor(R = 0.008, Q = 3) { this.R = R; this.Q = Q }
  filter(z: number): number {
    if (this.k === 0) { this.x = z; this.k = 1; return z }
    const Pp = this.P + this.Q
    const K  = Pp / (Pp + this.R)
    this.x   = this.x + K * (z - this.x)
    this.P   = (1 - K) * Pp
    return this.x
  }
  reset(z: number) { this.x = z; this.P = 1; this.k = 1 }
}

// ─── Haversine ───────────────────────────────────────────────────────────────
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6_371_000
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Tipos ───────────────────────────────────────────────────────────────────
interface AnimState {
  fromLat: number; fromLng: number; fromHeading: number
  toLat:   number; toLng:   number; toHeading:   number
  startTime: number
  segmentMs: number
}

interface AnimPos { lat: number; lng: number; heading: number }

// ─── Constantes ──────────────────────────────────────────────────────────────
// Si el nuevo punto está a más de esta distancia, teleportar directamente
const MAX_ANIM_DISTANCE_M = 500

function easeOut(t: number): number { return 1 - Math.pow(1 - Math.min(t, 1), 3) }

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  if (d >  180) d -= 360
  if (d < -180) d += 360
  return a + d * t
}

function estimateInterval(prev: string | undefined, next: string): number {
  if (!prev) return 15_000
  const delta = new Date(next).getTime() - new Date(prev).getTime()
  return Math.min(Math.max(delta, 5_000), 90_000)
}

function resolveWsUrl(): string | null {
  return (import.meta.env.VITE_WS_URL as string | undefined) ?? null
}

// ─── Estado de módulo — posición animada accesible desde fuera ───────────────
let _animPosMap = new Map<string, AnimPos>()

export function getAnimatedPosition(trackerName: string, deviceId: string): AnimPos | undefined {
  return _animPosMap.get(`${trackerName}/${deviceId}`)
}

// ─── GeoJSON builder ─────────────────────────────────────────────────────────
function devicesToFC(devices: Device[], animPos: Map<string, AnimPos>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: devices.map((d) => {
      const key  = `${d.trackerName}/${d.deviceId}`
      const anim = animPos.get(key)
      return {
        type: 'Feature',
        properties: {
          id:         d.deviceId,
          tracker:    d.trackerName,
          speed:      d.speed,
          heading:    anim?.heading ?? d.heading ?? 0,
          hasHeading: d.heading != null ? 1 : 0,
        },
        geometry: { type: 'Point', coordinates: [anim?.lng ?? d.lng, anim?.lat ?? d.lat] },
      }
    }),
  }
}

// ─── Layers ──────────────────────────────────────────────────────────────────
function addSourceAndLayers(map: MLMap) {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getLayer(CIRCLE_LAYER)) {
    map.addLayer({
      id: CIRCLE_LAYER, type: 'circle', source: SOURCE_ID,
      paint: {
        'circle-radius': 9, 'circle-color': '#00418b',
        'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.92,
      },
    })
  }
  if (!map.getLayer(ARROW_LAYER)) {
    map.addLayer({
      id: ARROW_LAYER, type: 'symbol', source: SOURCE_ID,
      layout: {
        'icon-image': 'vehicle-arrow', 'icon-size': 0.55,
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['case', ['==', ['get', 'hasHeading'], 1], 1, 0] },
    })
  }
  if (!map.getLayer(LABEL_LAYER)) {
    map.addLayer({
      id: LABEL_LAYER, type: 'symbol', source: SOURCE_ID,
      layout: {
        'text-field': ['get', 'id'], 'text-size': 11,
        'text-offset': [0, 1.8], 'text-anchor': 'top',
      },
      paint: { 'text-color': '#00418b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    })
  }
}

function loadArrowIcon(map: MLMap): Promise<void> {
  return new Promise((resolve) => {
    if (map.hasImage('vehicle-arrow')) { resolve(); return }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <polygon points="16,4 26,28 16,22 6,28" fill="white" stroke="#00418b" stroke-width="2" stroke-linejoin="round"/>
    </svg>`
    const img = new Image(32, 32)
    img.onload = () => { if (!map.hasImage('vehicle-arrow')) map.addImage('vehicle-arrow', img); resolve() }
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

// ─── Hook principal ───────────────────────────────────────────────────────────
export function useVehicleLayers() {
  const map                  = useMapStore(s => s.map)
  const mapReady             = useMapStore(s => s.mapReady)
  const devices              = useVehiclesStore(s => s.devices)
  const hiddenTrackers       = useVehiclesStore(s => s.hiddenTrackers)
  const hiddenDevices        = useVehiclesStore(s => s.hiddenDevices)
  const fetchAll             = useVehiclesStore(s => s.fetchAll)
  const upsertDevicePosition = useVehiclesStore(s => s.upsertDevicePosition)
  const phase                = useVehiclesStore(s => s.phase)
  const setPendingLocation   = useVehiclesStore(s => s.setPendingLocation)

  const fcRef        = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })
  const animPosRef   = useRef<Map<string, AnimPos>>(_animPosMap)
  const animStateRef = useRef<Map<string, AnimState>>(new Map())
  const kalmanRef    = useRef<Map<string, { lat: KalmanFilter; lng: KalmanFilter }>>(new Map())
  const mapRef       = useRef<MLMap | null>(null)
  const mapReadyRef  = useRef<boolean>(false)
  const lastUpdateAtRef = useRef<Map<string, string>>(new Map())
  const globalRafRef    = useRef<number | null>(null)
  // true solo cuando la pestaña es visible Y el usuario la está viendo
  const isVisibleRef    = useRef<boolean>(document.visibilityState === 'visible')

  useEffect(() => { mapRef.current = map ?? null }, [map])
  useEffect(() => { mapReadyRef.current = !!mapReady }, [mapReady])

  // ── Actualizar mapa con el FC cacheado ────────────────────────────────────
  const flushToMap = useCallback(() => {
    const source = mapRef.current?.getSource(SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(fcRef.current)
  }, [])

  // ── RAF global: solo corre cuando la pestaña es visible ───────────────────
  const startGlobalRaf = useCallback(() => {
    if (globalRafRef.current || !isVisibleRef.current) return

    const tick = (now: number) => {
      globalRafRef.current = null
      if (!isVisibleRef.current) return  // pestaña oculta — parar

      let anyActive = false
      const features = [...fcRef.current.features]
      let changed = false

      animStateRef.current.forEach((state: AnimState, key: string) => {
        const elapsed = now - state.startTime
        const t       = elapsed / state.segmentMs
        if (t >= 1) return  // terminada — quieto en destino

        const te      = easeOut(t)
        const lat     = state.fromLat + (state.toLat - state.fromLat) * te
        const lng     = state.fromLng + (state.toLng - state.fromLng) * te
        const heading = lerpAngle(state.fromHeading, state.toHeading, te)

        animPosRef.current.set(key, { lat, lng, heading })
        anyActive = true

        const [tracker, ...rest] = key.split('/')
        const deviceId = rest.join('/')
        const fi = features.findIndex(
          f => f.properties?.id === deviceId && f.properties?.tracker === tracker,
        )
        if (fi >= 0) {
          features[fi] = {
            ...features[fi],
            properties: { ...features[fi].properties, heading },
            geometry:   { type: 'Point', coordinates: [lng, lat] },
          }
          changed = true
        }
      })

      if (changed) {
        const newFc = { ...fcRef.current, features }
        fcRef.current = newFc
        flushToMap()
      }

      if (anyActive) globalRafRef.current = requestAnimationFrame(tick)
    }

    globalRafRef.current = requestAnimationFrame(tick)
  }, [flushToMap])

  // ── Page Visibility API ────────────────────────────────────────────────────
  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = document.visibilityState === 'visible'
      isVisibleRef.current = visible

      if (visible) {
        // Volvemos a la pestaña:
        // 1. Posicionar TODOS los marcadores en su última coordenada GPS real
        //    (sin animar, sin recuperar tiempo acumulado)
        // 2. Limpiar todas las animaciones pendientes
        animStateRef.current.clear()

        // Reconstruir FC con posiciones del store (ya actualizadas por WS en background)
        // El effect de devices se encargará del rebuild completo.
        // Aquí solo forzamos flush inmediato.
        flushToMap()
      } else {
        // Pestaña oculta: cancelar RAF — cero CPU en background
        if (globalRafRef.current) {
          cancelAnimationFrame(globalRafRef.current)
          globalRafRef.current = null
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [flushToMap])

  // ── Upsert: Kalman + animación solo si pestaña visible ────────────────────
  const wrappedUpsertRef = useRef<typeof upsertDevicePosition>((e) => upsertDevicePosition(e))

  useEffect(() => {
    wrappedUpsertRef.current = (event) => {
      const key = `${event.trackerName}/${event.deviceId}`

      // Kalman
      let kf = kalmanRef.current.get(key)
      if (!kf) {
        kf = { lat: new KalmanFilter(), lng: new KalmanFilter() }
        kalmanRef.current.set(key, kf)
      }
      const fLat = kf.lat.filter(event.lat)
      const fLng = kf.lng.filter(event.lng)

      // Intervalo dinámico
      const prevAt    = lastUpdateAtRef.current.get(key)
      const segmentMs = estimateInterval(prevAt, event.updatedAt)
      lastUpdateAtRef.current.set(key, event.updatedAt)

      // Posición actual animada
      const cur     = animPosRef.current.get(key)
      const fromLat = cur?.lat     ?? fLat
      const fromLng = cur?.lng     ?? fLng
      const fromHdg = cur?.heading ?? event.heading ?? 0
      const toHdg   = event.heading ?? fromHdg

      // Salto irreal → teleportar y resetear Kalman
      const distM = haversineM(fromLat, fromLng, fLat, fLng)
      if (distM > MAX_ANIM_DISTANCE_M) {
        kf.lat.reset(event.lat)
        kf.lng.reset(event.lng)
        animPosRef.current.set(key, { lat: event.lat, lng: event.lng, heading: toHdg })
        animStateRef.current.delete(key)
        upsertDevicePosition({ ...event })
        return
      }

      // Pestaña oculta → no animar, actualizar posición directamente al punto real
      if (!isVisibleRef.current) {
        animPosRef.current.set(key, { lat: fLat, lng: fLng, heading: toHdg })
        animStateRef.current.delete(key)
        upsertDevicePosition({ ...event, lat: fLat, lng: fLng })
        return
      }

      // Pestaña visible → animación suave
      animStateRef.current.set(key, {
        fromLat, fromLng, fromHeading: fromHdg,
        toLat: fLat, toLng: fLng, toHeading: toHdg,
        startTime: performance.now(),
        segmentMs,
      })

      startGlobalRaf()
      upsertDevicePosition({ ...event, lat: fLat, lng: fLng })
    }
  }, [upsertDevicePosition, startGlobalRaf])

  // ── WebSocket con backoff exponencial ─────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return
    fetchAll()

    const wsUrl = resolveWsUrl()
    if (!wsUrl) { console.warn('VITE_WS_URL no configurado.'); return }

    let socket:         WebSocket | null = null
    let reconnectTimer: number | undefined
    let isStopped       = false
    let backoffMs       = 1_500
    const MAX_BACKOFF   = 30_000

    const connect = () => {
      if (isStopped) return
      socket = new WebSocket(wsUrl)
      socket.onopen  = () => { backoffMs = 1_500 }
      socket.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as {
            type?: string
            payload?: {
              trackerName: string; deviceId: string
              lat: number; lng: number
              speed: number | null; heading: number | null; updatedAt: string
            }
          }
          if (data.type === 'device_position' && data.payload) {
            wrappedUpsertRef.current(data.payload)
          }
        } catch {}
      }
      socket.onclose = (ev) => {
        if (isStopped || ev.code === 1000) return
        reconnectTimer = window.setTimeout(() => {
          backoffMs = Math.min(backoffMs * 1.5, MAX_BACKOFF)
          connect()
        }, backoffMs)
      }
      socket.onerror = () => { socket?.close() }
    }

    // Reconectar al volver a la pestaña si el socket se cayó
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        if (!socket || socket.readyState === WebSocket.CLOSED) {
          backoffMs = 1_500
          connect()
        }
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    connect()

    return () => {
      isStopped = true
      document.removeEventListener('visibilitychange', onVisible)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close(1000, 'unmount')
      if (globalRafRef.current) { cancelAnimationFrame(globalRafRef.current); globalRafRef.current = null }
    }
  }, [mapReady, fetchAll])

  // ── Reload layers tras cambio de estilo ───────────────────────────────────
  useEffect(() => {
    if (!map || !mapReady) return
    const setup = () => {
      if ((map as any)._removed) return
      loadArrowIcon(map).then(() => {
        addSourceAndLayers(map)
        ;(map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(fcRef.current)
      })
    }
    setup()
    map.on('styledata', setup)
    return () => { map.off('styledata', setup) }
  }, [map, mapReady])

  // ── Click para colocar dispositivo ────────────────────────────────────────
  useEffect(() => {
    if (!map) return
    const canvas = map.getCanvas()
    if (phase === 'placing') {
      canvas.style.cursor = 'crosshair'
      const onClick = (e: MapMouseEvent) => setPendingLocation({ lat: e.lngLat.lat, lng: e.lngLat.lng })
      map.on('click', onClick)
      return () => { map.off('click', onClick); canvas.style.cursor = '' }
    }
    canvas.style.cursor = ''
  }, [map, phase, setPendingLocation])

  // ── Rebuild GeoJSON cuando cambian devices ────────────────────────────────
  useEffect(() => {
    if (!map || !mapReady) return
    if ((map as any)._removed) return
    const visible = devices.filter(d =>
      !hiddenTrackers[d.trackerName] && !hiddenDevices[`${d.trackerName}/${d.deviceId}`],
    )
    const fc = devicesToFC(visible, animPosRef.current)
    fcRef.current = fc
    ;(map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(fc)
  }, [map, mapReady, devices, hiddenTrackers, hiddenDevices])
}
