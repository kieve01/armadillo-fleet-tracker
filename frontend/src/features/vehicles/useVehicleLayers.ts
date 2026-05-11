import { useEffect, useRef, useCallback } from 'react'
import type { Map, GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
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

// ─── Estado de animación por dispositivo ─────────────────────────────────────
interface AnimState {
  // Posición de partida de este segmento
  fromLat: number; fromLng: number; fromHeading: number
  // Posición destino (último update recibido)
  toLat: number; toLng: number; toHeading: number
  // Velocidad (m/s) y heading para dead reckoning más allá del destino
  speedMs: number; drHeading: number
  // Timing
  startTime: number      // performance.now() cuando arrancó este segmento
  segmentMs: number      // duración estimada del segmento (intervalo del tracker)
  lastUpdateAt: number   // timestamp epoch del último update recibido
  rafId: number | null
}

// Posición animada actual (se actualiza frame a frame)
interface AnimPos { lat: number; lng: number; heading: number }

// ─── Helpers matemáticos ─────────────────────────────────────────────────────
const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI
const EARTH_R = 6_371_000 // metros

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  if (d >  180) d -= 360
  if (d < -180) d += 360
  return a + d * t
}

// Proyecta una posición hacia adelante usando velocidad y heading (dead reckoning)
function projectPosition(lat: number, lng: number, headingDeg: number, speedMs: number, elapsedS: number): { lat: number; lng: number } {
  if (speedMs < 0.5) return { lat, lng } // detenido — no proyectar
  const dist    = speedMs * elapsedS
  const heading = headingDeg * DEG2RAD
  const dLat    = (dist * Math.cos(heading)) / EARTH_R * RAD2DEG
  const dLng    = (dist * Math.sin(heading)) / (EARTH_R * Math.cos(lat * DEG2RAD)) * RAD2DEG
  return { lat: lat + dLat, lng: lng + dLng }
}

function resolveWsUrl(): string | null {
  const v = import.meta.env.VITE_WS_URL as string | undefined
  return v ?? null
}

function devicesToFC(
  devices: Device[],
  animPos: Map<string, AnimPos>,
): GeoJSON.FeatureCollection {
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
          hasHeading: (d.heading != null) ? 1 : 0,
        },
        geometry: { type: 'Point', coordinates: [anim?.lng ?? d.lng, anim?.lat ?? d.lat] },
      }
    }),
  }
}

function addSourceAndLayers(map: Map) {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getLayer(CIRCLE_LAYER)) {
    map.addLayer({
      id: CIRCLE_LAYER, type: 'circle', source: SOURCE_ID,
      paint: {
        'circle-radius': 9, 'circle-color': '#00418b',
        'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff', 'circle-opacity': 0.92,
      },
    })
  }
  // Flecha: visible si hay heading válido (hasHeading=1), independiente de speed
  if (!map.getLayer(ARROW_LAYER)) {
    map.addLayer({
      id: ARROW_LAYER, type: 'symbol', source: SOURCE_ID,
      layout: {
        'icon-image': 'vehicle-arrow',
        'icon-size':  0.55,
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        // Visible si hasHeading=1; fade-in/out suave via opacity expression
        'icon-opacity': ['case', ['==', ['get', 'hasHeading'], 1], 1, 0],
      },
    })
  }
  if (!map.getLayer(LABEL_LAYER)) {
    map.addLayer({
      id: LABEL_LAYER, type: 'symbol', source: SOURCE_ID,
      layout: {
        'text-field': ['get', 'id'], 'text-size': 11,
        'text-offset': [0, 1.8], 'text-anchor': 'top',
      },
      paint: {
        'text-color': '#00418b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5,
      },
    })
  }
}

function loadArrowIcon(map: Map): Promise<void> {
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

// Estima el intervalo del tracker (ms) a partir de los dos últimos timestamps
// Clampado entre 5s y 90s para absorber anomalías
function estimateInterval(prevUpdatedAt: string | undefined, newUpdatedAt: string): number {
  if (!prevUpdatedAt) return 15_000
  const delta = new Date(newUpdatedAt).getTime() - new Date(prevUpdatedAt).getTime()
  return Math.min(Math.max(delta, 5_000), 90_000)
}

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
  const animPosRef   = useRef<Map<string, AnimPos>>(new Map())
  const animStateRef = useRef<Map<string, AnimState>>(new Map())
  const kalmanRef    = useRef<Map<string, { lat: KalmanFilter; lng: KalmanFilter }>>(new Map())
  const mapRef       = useRef<Map | null>(null)
  // Guarda el último updatedAt por device para calcular el intervalo real
  const lastUpdateAtRef = useRef<Map<string, string>>(new Map())
  // RAF global — un solo loop para todos los devices
  const globalRafRef = useRef<number | null>(null)
  // Controla si la pestaña está visible (Page Visibility API)
  const isVisibleRef = useRef<boolean>(true)
  // Marca si el mapa está listo para recibir datos
  const mapReadyRef = useRef<boolean>(false)

  useEffect(() => { mapRef.current = map ?? null }, [map])
  useEffect(() => { mapReadyRef.current = !!mapReady }, [mapReady])

  // ─── RAF global: un solo loop anima TODOS los devices ────────────────────
  const startGlobalRaf = useCallback(() => {
    if (globalRafRef.current) return // ya corriendo

    const tick = (now: number) => {
      globalRafRef.current = null
      const currentMap = mapRef.current
      if (!currentMap || !mapReadyRef.current) return

      let anyActive = false
      const features = [...fcRef.current.features]
      let changed = false

      animStateRef.current.forEach((state, key) => {
        const parts    = key.split('/')
        const deviceId = parts.slice(1).join('/')
        const tracker  = parts[0]

        // Fase 1: interpolación entre fromPos y toPos
        const elapsed  = now - state.startTime
        const t        = elapsed / state.segmentMs

        let lat: number, lng: number, heading: number

        if (t <= 1) {
          // Dentro del segmento — interpolar suavemente
          const te  = easeInOut(Math.min(t, 1))
          lat       = state.fromLat + (state.toLat - state.fromLat) * te
          lng       = state.fromLng + (state.toLng - state.fromLng) * te
          heading   = lerpAngle(state.fromHeading, state.toHeading, te)
          anyActive = true
        } else {
          // Fase 2: dead reckoning — el vehículo sigue moviéndose más allá del destino
          // solo si lleva velocidad; si está detenido se queda en toLat/toLng
          const overElapsed = (elapsed - state.segmentMs) / 1000 // segundos de sobra
          const dr = projectPosition(state.toLat, state.toLng, state.drHeading, state.speedMs, overElapsed)
          lat     = dr.lat
          lng     = dr.lng
          heading = state.drHeading
          // Seguimos animando mientras no llegue el próximo update (máx 2× el intervalo)
          if (elapsed < state.segmentMs * 2) anyActive = true
        }

        animPosRef.current.set(key, { lat, lng, heading })

        // Actualizar el feature correspondiente en el FC cacheado
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
        const source = currentMap.getSource(SOURCE_ID) as GeoJSONSource | undefined
        source?.setData(newFc)
      }

      if (anyActive) {
        globalRafRef.current = requestAnimationFrame(tick)
      }
    }

    globalRafRef.current = requestAnimationFrame(tick)
  }, [])

  // ─── Page Visibility API: pausa RAF cuando pestaña oculta ────────────────
  useEffect(() => {
    const onVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === 'visible'

      if (isVisibleRef.current) {
        // Volvemos a la pestaña: recalibrar startTime de todas las animaciones
        // para que no haya salto por el tiempo que estuvo oculta
        const now = performance.now()
        animStateRef.current.forEach((state, key) => {
          // Reset: la posición "desde" es la animada actual
          const cur = animPosRef.current.get(key)
          if (cur) {
            animStateRef.current.set(key, {
              ...state,
              fromLat:     cur.lat,
              fromLng:     cur.lng,
              fromHeading: cur.heading,
              startTime:   now,
            })
          }
        })
        startGlobalRaf()
      } else {
        // Pestaña oculta: cancelar RAF para no quemar CPU en background
        if (globalRafRef.current) {
          cancelAnimationFrame(globalRafRef.current)
          globalRafRef.current = null
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [startGlobalRaf])

  // ─── Upsert envuelto: Kalman + animación con intervalo dinámico ──────────
  const wrappedUpsertRef = useRef<typeof upsertDevicePosition>((e) => upsertDevicePosition(e))

  useEffect(() => {
    wrappedUpsertRef.current = (event) => {
      const key = `${event.trackerName}/${event.deviceId}`

      // Kalman — suaviza ruido GPS
      let kf = kalmanRef.current.get(key)
      if (!kf) {
        kf = { lat: new KalmanFilter(), lng: new KalmanFilter() }
        kalmanRef.current.set(key, kf)
      }
      const fLat = kf.lat.filter(event.lat)
      const fLng = kf.lng.filter(event.lng)

      // Intervalo dinámico según la fuente (Jetson ~15s, Frotcom ~60s, etc.)
      const prevUpdatedAt = lastUpdateAtRef.current.get(key)
      const segmentMs     = estimateInterval(prevUpdatedAt, event.updatedAt)
      lastUpdateAtRef.current.set(key, event.updatedAt)

      // Posición "desde" = posición animada actual
      const cur       = animPosRef.current.get(key)
      const fromLat   = cur?.lat     ?? fLat
      const fromLng   = cur?.lng     ?? fLng
      const fromHdg   = cur?.heading ?? event.heading ?? 0
      const toHdg     = event.heading ?? fromHdg
      const speedMs   = event.speed != null ? event.speed / 3.6 : 0 // km/h → m/s

      animStateRef.current.set(key, {
        fromLat, fromLng, fromHeading: fromHdg,
        toLat: fLat, toLng: fLng, toHeading: toHdg,
        speedMs, drHeading: toHdg,
        startTime:    performance.now(),
        segmentMs,
        lastUpdateAt: new Date(event.updatedAt).getTime(),
        rafId:        null,
      })

      // Arrancar/continuar el RAF global
      if (isVisibleRef.current) startGlobalRaf()

      // Propagar al store con coordenadas filtradas
      upsertDevicePosition({ ...event, lat: fLat, lng: fLng })
    }
  }, [upsertDevicePosition, startGlobalRaf])

  // ─── WebSocket con reconexión robusta ─────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return
    fetchAll()

    const wsUrl = resolveWsUrl()
    if (!wsUrl) { console.warn('VITE_WS_URL no configurado.'); return }

    let socket:         WebSocket | null = null
    let reconnectTimer: number | undefined
    let isStopped       = false
    let backoffMs       = 1_500   // backoff inicial
    const MAX_BACKOFF   = 30_000  // máximo 30s entre intentos

    const connect = () => {
      if (isStopped) return
      socket = new WebSocket(wsUrl)

      socket.onopen = () => {
        backoffMs = 1_500 // reset backoff al conectar exitosamente
      }

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
        if (isStopped) return
        // No reconectar en cierre limpio intencional (code 1000)
        if (ev.code === 1000) return
        reconnectTimer = window.setTimeout(() => {
          backoffMs = Math.min(backoffMs * 1.5, MAX_BACKOFF) // backoff exponencial
          connect()
        }, backoffMs)
      }

      socket.onerror = () => { socket?.close() }
    }

    // Reconectar también cuando la pestaña vuelve a ser visible
    // (el WS puede haberse caído mientras estaba en background)
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

  // ─── Reload layers tras cambio de estilo de mapa ─────────────────────────
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

  // ─── Click para colocar dispositivo ──────────────────────────────────────
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

  // ─── Reconstruir GeoJSON cuando cambia la lista de devices ───────────────
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
