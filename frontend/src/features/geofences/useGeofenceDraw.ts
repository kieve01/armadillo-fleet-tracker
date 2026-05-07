import { useEffect, useRef } from 'react'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import type { IControl } from 'maplibre-gl'
import CircleMode from './circleDrawMode'
import { useMapStore } from '../../store/mapStore'
import { useGeofencesStore } from './geofencesStore'

export function useGeofenceDraw() {
  const map = useMapStore((s) => s.map)
  const mapReady = useMapStore((s) => s.mapReady)
  const phase = useGeofencesStore((s) => s.phase)
  const draft = useGeofencesStore((s) => s.draft)
  const setDraftFeature = useGeofencesStore((s) => s.setDraftFeature)
  const drawRef = useRef<MapboxDraw | null>(null)

  // Initialize draw control once when map is ready
  useEffect(() => {
    if (!map || !mapReady || drawRef.current) return

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      modes: { ...MapboxDraw.modes, draw_circle: CircleMode },
    })

    map.addControl(draw as unknown as IControl)

    const onDrawCreate = (e: { features: GeoJSON.Feature[] }) => {
      if (e.features[0]) setDraftFeature(e.features[0])
    }

    map.on('draw.create', onDrawCreate)
    drawRef.current = draw

    return () => {
      map.off('draw.create', onDrawCreate)
      map.removeControl(draw as unknown as IControl)
      drawRef.current = null
    }
  }, [map, mapReady, setDraftFeature])

  // React to phase changes
  useEffect(() => {
    const draw = drawRef.current
    if (!draw) return

    if (phase === 'drawing' && draft) {
      draw.deleteAll()
      if (draft.mode === 'circle') {
        draw.changeMode('draw_circle')
      } else {
        draw.changeMode('draw_polygon')
      }
    }

    if (phase === 'idle') {
      draw.deleteAll()
      draw.changeMode('simple_select')
    }
  }, [phase, draft])
}
