import { useEffect, useRef } from 'react'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import type { IControl } from 'maplibre-gl'
import CircleMode from './circleDrawMode'
import { useMapStore } from '../../store/mapStore'
import { useGeofencesStore } from './geofencesStore'

// Estilos por defecto de mapbox-gl-draw con line-dasharray corregido para MapLibre.
// MapLibre rechaza la sintaxis de expresión ["literal",[...]] en line-dasharray;
// el valor debe ser un array plano de números.
const DRAW_STYLES: object[] = [
  {
    id: 'gl-draw-polygon-fill-inactive',
    type: 'fill',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
    paint: { 'fill-color': '#3bb2d0', 'fill-outline-color': '#3bb2d0', 'fill-opacity': 0.1 },
  },
  {
    id: 'gl-draw-polygon-fill-active',
    type: 'fill',
    filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
    paint: { 'fill-color': '#fbb03b', 'fill-outline-color': '#fbb03b', 'fill-opacity': 0.1 },
  },
  {
    id: 'gl-draw-polygon-midpoint',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
    paint: { 'circle-radius': 3, 'circle-color': '#fbb03b' },
  },
  {
    id: 'gl-draw-polygon-stroke-inactive',
    type: 'line',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#3bb2d0', 'line-width': 2 },
  },
  {
    id: 'gl-draw-polygon-stroke-active',
    type: 'line',
    filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    // Antes era ['literal',[2,2]] — MapLibre requiere array plano
    paint: { 'line-color': '#fbb03b', 'line-dasharray': [0.2, 2], 'line-width': 2 },
  },
  {
    id: 'gl-draw-line-inactive',
    type: 'line',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#3bb2d0', 'line-width': 2 },
  },
  {
    id: 'gl-draw-line-active',
    type: 'line',
    filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'LineString']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    // Antes era ['literal',[2,2]] — MapLibre requiere array plano
    paint: { 'line-color': '#fbb03b', 'line-dasharray': [0.2, 2], 'line-width': 2 },
  },
  // Capas gl-draw-lines (cold/hot) que tiraban el error — dasharray plano
  {
    id: 'gl-draw-lines.cold',
    type: 'line',
    filter: ['all', ['==', '$type', 'LineString']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#3bb2d0', 'line-dasharray': [2, 2], 'line-width': 2 },
  },
  {
    id: 'gl-draw-lines.hot',
    type: 'line',
    filter: ['all', ['==', '$type', 'LineString']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fbb03b', 'line-dasharray': [2, 2], 'line-width': 2 },
  },
  {
    id: 'gl-draw-polygon-and-line-vertex-stroke-inactive',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
    paint: { 'circle-radius': 5, 'circle-color': '#fff' },
  },
  {
    id: 'gl-draw-polygon-and-line-vertex-inactive',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
    paint: { 'circle-radius': 3, 'circle-color': '#fbb03b' },
  },
  {
    id: 'gl-draw-point-point-stroke-inactive',
    type: 'circle',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature'], ['!=', 'mode', 'static']],
    paint: { 'circle-radius': 5, 'circle-opacity': 1, 'circle-color': '#fff' },
  },
  {
    id: 'gl-draw-point-inactive',
    type: 'circle',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature'], ['!=', 'mode', 'static']],
    paint: { 'circle-radius': 3, 'circle-color': '#3bb2d0' },
  },
  {
    id: 'gl-draw-point-stroke-active',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'active', 'true'], ['!=', 'meta', 'midpoint']],
    paint: { 'circle-radius': 7, 'circle-color': '#fff' },
  },
  {
    id: 'gl-draw-point-active',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['!=', 'meta', 'midpoint'], ['==', 'active', 'true']],
    paint: { 'circle-radius': 5, 'circle-color': '#fbb03b' },
  },
  {
    id: 'gl-draw-polygon-fill-static',
    type: 'fill',
    filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Polygon']],
    paint: { 'fill-color': '#404040', 'fill-outline-color': '#404040', 'fill-opacity': 0.1 },
  },
  {
    id: 'gl-draw-polygon-stroke-static',
    type: 'line',
    filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Polygon']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#404040', 'line-width': 2 },
  },
  {
    id: 'gl-draw-line-static',
    type: 'line',
    filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'LineString']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#404040', 'line-width': 2 },
  },
  {
    id: 'gl-draw-point-static',
    type: 'circle',
    filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Point']],
    paint: { 'circle-radius': 5, 'circle-color': '#404040' },
  },
]

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
      styles: DRAW_STYLES,
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
