import { useRef, useEffect } from 'react'
import { useUIStore } from '../../store/uiStore'
import { useMapStore } from '../../store/mapStore'
import { useMap } from '../../hooks/useMap'
import { useGeofenceLayers } from '../../features/geofences/useGeofenceLayers'
import { useGeofenceDraw } from '../../features/geofences/useGeofenceDraw'
import { useVehicleLayers } from '../../features/vehicles/useVehicleLayers'
import { useRouteLayers } from '../../features/routes/useRouteLayers'
import { useRouteDraw } from '../../features/routes/useRouteDraw'
import { buildStyleUrl } from './mapHelpers'

const REGION  = import.meta.env.VITE_AWS_REGION as string
const API_KEY = import.meta.env.VITE_MAP_API_KEY as string

function MapInner() {
  const containerRef = useRef<HTMLDivElement>(null)
  useMap(containerRef)
  useGeofenceLayers()
  useGeofenceDraw()
  useVehicleLayers()
  useRouteLayers()
  useRouteDraw()
  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}

function useMapStyleSync() {
  const map            = useMapStore((s) => s.map)
  const mapStyle       = useUIStore((s) => s.mapStyle)
  const trafficEnabled = useUIStore((s) => s.trafficEnabled)
  const themeMode      = useUIStore((s) => s.themeMode)
  const darkMap        = useUIStore((s) => s.darkMap)

  // Cambio de estilo/tráfico → setStyle preservando posición
  useEffect(() => {
    if (!map) return
    const newUrl = buildStyleUrl(REGION, mapStyle, API_KEY, trafficEnabled)
    if ((map as any).__styleUrl === newUrl) return
    ;(map as any).__styleUrl = newUrl

    const center  = map.getCenter()
    const zoom    = map.getZoom()
    const bearing = map.getBearing()
    const pitch   = map.getPitch()

    map.setStyle(newUrl)
    map.once('styledata', () => map.jumpTo({ center, zoom, bearing, pitch }))
  }, [map, mapStyle, trafficEnabled])

  // Mapa oscuro: filtro CSS sobre canvas, solo en Standard y cuando darkMap=true
  // En Hybrid/Satellite no aplica (foto satelital queda mal invertida)
  useEffect(() => {
    if (!map) return
    const canvas = map.getCanvas()
    if (!canvas) return
    const applyDark = darkMap && mapStyle === 'Standard'
    canvas.style.filter = applyDark
      ? 'invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.9)'
      : ''
  }, [map, mapStyle, darkMap, themeMode])
}

export default function MapView() {
  useMapStyleSync()
  return (
    <div style={{ flex: 1, height: '100%', position: 'relative' }}>
      <MapInner />
    </div>
  )
}
