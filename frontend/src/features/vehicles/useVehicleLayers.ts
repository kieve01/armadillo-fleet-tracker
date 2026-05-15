/**
 * useVehicleLayers — Fase 0: datos crudos
 *
 * Sin Kalman, sin animación RAF, sin lerp de ángulos.
 * Los puntos saltan directo a la coordenada nueva cuando llega el WS.
 * Base limpia para iterar encima.
 */

import { useEffect, useRef, useCallback } from 'react'
import type { Map as MLMap, GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import { useMapStore } from '../../store/mapStore'
import { useVehiclesStore } from './vehiclesStore'
import type { Device } from './types'

// ─── Constantes de capas ──────────────────────────────────────────────────────
const SOURCE_ID    = 'trackers-source'
const CIRCLE_LAYER = 'trackers-circle'
const LABEL_LAYER  = 'trackers-label'
const ARROW_LAYER  = 'trackers-arrow'

// ─── GeoJSON builder ──────────────────────────────────────────────────────────
function devicesToFC(devices: Device[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: devices.map((d) => ({
      type: 'Feature',
      properties: {
        id:         d.deviceId,
        tracker:    d.trackerName,
        speed:      d.speed,
        heading:    d.heading ?? 0,
        hasHeading: d.heading != null ? 1 : 0,
      },
      geometry: {
        type: 'Point',
        coordinates: [d.lng, d.lat],
      },
    })),
  }
}

// ─── Capas MapLibre ───────────────────────────────────────────────────────────
function addSourceAndLayers(map: MLMap) {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }

  if (!map.getLayer(CIRCLE_LAYER)) {
    map.addLayer({
      id: CIRCLE_LAYER, type: 'circle', source: SOURCE_ID,
      paint: {
        'circle-radius':       9,
        'circle-color':        '#00418b',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff',
        'circle-opacity':      0.92,
      },
    })
  }

  if (!map.getLayer(ARROW_LAYER)) {
    map.addLayer({
      id: ARROW_LAYER, type: 'symbol', source: SOURCE_ID,
      layout: {
        'icon-image':                'vehicle-arrow',
        'icon-size':                 0.55,
        'icon-rotate':               ['get', 'heading'],
        'icon-rotation-alignment':   'map',
        'icon-allow-overlap':        true,
        'icon-ignore-placement':     true,
      },
      paint: {
        'icon-opacity': ['case', ['==', ['get', 'hasHeading'], 1], 1, 0],
      },
    })
  }

  if (!map.getLayer(LABEL_LAYER)) {
    map.addLayer({
      id: LABEL_LAYER, type: 'symbol', source: SOURCE_ID,
      layout: {
        'text-field':  ['get', 'id'],
        'text-size':   11,
        'text-offset': [0, 1.8],
        'text-anchor': 'top',
      },
      paint: {
        'text-color':       '#00418b',
        'text-halo-color':  '#ffffff',
        'text-halo-width':  1.5,
      },
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
    img.onload = () => {
      if (!map.hasImage('vehicle-arrow')) map.addImage('vehicle-arrow', img)
      resolve()
    }
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

function resolveWsUrl(): string | null {
  return (import.meta.env.VITE_WS_URL as string | undefined) ?? null
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

  const mapRef = useRef<MLMap | null>(null)
  useEffect(() => { mapRef.current = map ?? null }, [map])

  // ── Flush al mapa ─────────────────────────────────────────────────────────
  const flushToMap = useCallback((fc: GeoJSON.FeatureCollection) => {
    const source = mapRef.current?.getSource(SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(fc)
  }, [])

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
      socket.onopen    = () => { backoffMs = 1_500 }
      socket.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as {
            type?:    string
            payload?: {
              trackerName: string; deviceId: string
              lat: number; lng: number
              speed: number | null; heading: number | null; updatedAt: string
            }
          }
          if (data.type === 'device_position' && data.payload) {
            upsertDevicePosition(data.payload)
          }
        } catch { /* mensaje malformado, ignorar */ }
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

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        if (!socket || socket.readyState === WebSocket.CLOSED) {
          backoffMs = 1_500; connect()
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
    }
  }, [mapReady, fetchAll, upsertDevicePosition])

  // ── Reload de capas tras cambio de estilo de mapa ─────────────────────────
  useEffect(() => {
    if (!map || !mapReady) return
    const setup = () => {
      if ((map as any)._removed) return
      loadArrowIcon(map).then(() => addSourceAndLayers(map))
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
      const onClick = (e: MapMouseEvent) =>
        setPendingLocation({ lat: e.lngLat.lat, lng: e.lngLat.lng })
      map.on('click', onClick)
      return () => { map.off('click', onClick); canvas.style.cursor = '' }
    }
    canvas.style.cursor = ''
  }, [map, phase, setPendingLocation])

  // ── Rebuild GeoJSON cuando cambian devices o visibilidad ──────────────────
  useEffect(() => {
    if (!map || !mapReady) return
    if ((map as any)._removed) return

    const visible = devices.filter(d =>
      !hiddenTrackers[d.trackerName] &&
      !hiddenDevices[`${d.trackerName}/${d.deviceId}`],
    )
    flushToMap(devicesToFC(visible))
  }, [map, mapReady, devices, hiddenTrackers, hiddenDevices, flushToMap])
}
