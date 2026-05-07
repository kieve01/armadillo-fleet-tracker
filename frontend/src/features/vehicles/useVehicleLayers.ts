import { useEffect, useRef } from 'react'
import type { Map, GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import { useMapStore } from '../../store/mapStore'
import { useVehiclesStore } from './vehiclesStore'
import type { Device } from './types'

const SOURCE_ID    = 'trackers-source'
const CIRCLE_LAYER = 'trackers-circle'
const LABEL_LAYER  = 'trackers-label'

function resolveWsUrl(): string | null {
  const explicitUrl = import.meta.env.VITE_WS_URL as string | undefined
  if (explicitUrl) return explicitUrl
  return null
}

function devicesToFC(devices: Device[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: devices.map((d) => ({
      type: 'Feature',
      properties: { id: d.deviceId, tracker: d.trackerName, speed: d.speed },
      geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
    })),
  }
}

function addSourceAndLayers(map: Map) {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }

  if (!map.getLayer(CIRCLE_LAYER)) {
    map.addLayer({
      id:     CIRCLE_LAYER,
      type:   'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius':       9,
        'circle-color':        '#00418b',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff',
        'circle-opacity':      0.92,
      },
    })
  }

  if (!map.getLayer(LABEL_LAYER)) {
    map.addLayer({
      id:     LABEL_LAYER,
      type:   'symbol',
      source: SOURCE_ID,
      layout: {
        'text-field':   ['get', 'id'],
        'text-size':    11,
        'text-offset':  [0, 1.8],
        'text-anchor':  'top',
      },
      paint: {
        'text-color':      '#00418b',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    })
  }
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
  const fcRef                = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })

  // Fetch inicial + WebSocket
  useEffect(() => {
    if (!mapReady) return

    fetchAll()

    const wsUrl = resolveWsUrl()
    if (!wsUrl) {
      console.warn('VITE_WS_URL no configurado. Tiempo real deshabilitado.')
      return
    }

    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let isStopped = false

    const connect = () => {
      if (isStopped) return
      socket = new WebSocket(wsUrl)
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as {
            type?: string
            payload?: {
              trackerName: string; deviceId: string
              lat: number; lng: number
              speed: number | null; heading: number | null; updatedAt: string
            }
          }
          if (data.type === 'device_position' && data.payload) {
            upsertDevicePosition(data.payload)
          }
        } catch {}
      }
      socket.onclose = () => { if (!isStopped) reconnectTimer = window.setTimeout(connect, 1500) }
      socket.onerror = () => { socket?.close() }
    }

    connect()

    return () => {
      isStopped = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [mapReady, fetchAll, upsertDevicePosition])

  // Re-añadir layers tras cambio de estilo
  useEffect(() => {
    if (!map || !mapReady) return
    if ((map as any)._removed) return
    addSourceAndLayers(map)
    const onStyleData = () => {
      if ((map as any)._removed) return
      addSourceAndLayers(map)
      ;(map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(fcRef.current)
    }
    map.on('styledata', onStyleData)
    return () => { map.off('styledata', onStyleData) }
  }, [map, mapReady])

  // Click para colocar dispositivo
  useEffect(() => {
    if (!map) return
    const canvas = map.getCanvas()
    if (phase === 'placing') {
      canvas.style.cursor = 'crosshair'
      const onClick = (e: MapMouseEvent) => setPendingLocation({ lat: e.lngLat.lat, lng: e.lngLat.lng })
      map.on('click', onClick)
      return () => { map.off('click', onClick); canvas.style.cursor = '' }
    } else {
      canvas.style.cursor = ''
    }
  }, [map, phase, setPendingLocation])

  // Actualizar markers al cambiar devices
  useEffect(() => {
    if (!map || !mapReady) return
    if ((map as any)._removed) return
    const visible = devices.filter(d => {
      if (hiddenTrackers[d.trackerName]) return false
      return !hiddenDevices[`${d.trackerName}/${d.deviceId}`]
    })
    const fc = devicesToFC(visible)
    fcRef.current = fc
    ;(map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(fc)
  }, [map, mapReady, devices, hiddenTrackers, hiddenDevices])
}
