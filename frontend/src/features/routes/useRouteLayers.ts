import { useEffect, useRef } from 'react'
import type { GeoJSONSource, Map } from 'maplibre-gl'
import { useMapStore } from '../../store/mapStore'
import { useRoutesStore } from './routesStore'
import type { RouteResource } from './types'
import type { CalculateRouteResult } from './routesService'

const SOURCE_ID      = 'routes-source'
const LINE_LAYER     = 'routes-line-layer'
const PREVIEW_SOURCE = 'routes-preview-source'
const PREVIEW_LAYER  = 'routes-preview-layer'
const PINS_SOURCE    = 'routes-pins-source'
const PINS_LAYER_CIRCLE = 'routes-pins-circle'
const PINS_LAYER_LABEL  = 'routes-pins-label'

function routesToFC(routes: RouteResource[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes.filter(r => r.geometry.length >= 2).map(r => ({
      type: 'Feature' as const,
      properties: { id: r.routeId, travelMode: r.travelMode },
      geometry: { type: 'LineString' as const, coordinates: r.geometry },
    })),
  }
}

function previewToFC(preview: CalculateRouteResult | null): GeoJSON.FeatureCollection {
  if (!preview || preview.geometry.length < 2) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { travelMode: preview.travelMode },
      geometry: { type: 'LineString', coordinates: preview.geometry },
    }],
  }
}

// Pins A y B para origen y destino de la ruta calculada
function pinsToFC(preview: CalculateRouteResult | null): GeoJSON.FeatureCollection {
  if (!preview || preview.snappedWaypoints.length < 2) return { type: 'FeatureCollection', features: [] }
  const [origin, destination] = preview.snappedWaypoints
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { label: 'A' },
        geometry: { type: 'Point', coordinates: origin },
      },
      {
        type: 'Feature',
        properties: { label: 'B' },
        geometry: { type: 'Point', coordinates: destination },
      },
    ],
  }
}

function addSourceAndLayers(map: Map): void {
  // Rutas guardadas — naranja
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getLayer(LINE_LAYER)) {
    map.addLayer({
      id: LINE_LAYER, type: 'line', source: SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#f97316', 'line-width': 4, 'line-opacity': 0.9 },
    })
  }

  // Preview de ruta calculada — azul punteado
  if (!map.getSource(PREVIEW_SOURCE)) {
    map.addSource(PREVIEW_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getLayer(PREVIEW_LAYER)) {
    map.addLayer({
      id: PREVIEW_LAYER, type: 'line', source: PREVIEW_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#00418b', 'line-width': 4, 'line-opacity': 0.85,
        'line-dasharray': [2, 2],
      },
    })
  }

  // Pins A/B
  if (!map.getSource(PINS_SOURCE)) {
    map.addSource(PINS_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getLayer(PINS_LAYER_CIRCLE)) {
    map.addLayer({
      id: PINS_LAYER_CIRCLE, type: 'circle', source: PINS_SOURCE,
      paint: {
        'circle-radius': 12,
        'circle-color':  '#00418b',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff',
      },
    })
  }
  if (!map.getLayer(PINS_LAYER_LABEL)) {
    map.addLayer({
      id: PINS_LAYER_LABEL, type: 'symbol', source: PINS_SOURCE,
      layout: {
        'text-field':  ['get', 'label'],
        'text-size':   12,
        'text-font':   ['literal', ['Amazon Ember Bold', 'Noto Sans Bold']],
        'text-anchor': 'center',
        'text-offset': [0, 0],
      },
      paint: {
        'text-color': '#ffffff',
      },
    })
  }
}

export function useRouteLayers() {
  const map             = useMapStore(s => s.map)
  const mapReady        = useMapStore(s => s.mapReady)
  const routes          = useRoutesStore(s => s.routes)
  const selectedRouteId = useRoutesStore(s => s.selectedRouteId)
  const fetchRoutes     = useRoutesStore(s => s.fetchRoutes)
  const previewRoute    = useRoutesStore(s => s.previewRoute)

  const fcRef      = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })
  const prevFcRef  = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })
  const pinsFcRef  = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })

  useEffect(() => { if (mapReady) fetchRoutes() }, [mapReady, fetchRoutes])

  useEffect(() => {
    if (!map || !mapReady) return
    addSourceAndLayers(map)
    const onStyleData = () => {
      addSourceAndLayers(map)
      ;(map.getSource(SOURCE_ID)      as GeoJSONSource | undefined)?.setData(fcRef.current)
      ;(map.getSource(PREVIEW_SOURCE) as GeoJSONSource | undefined)?.setData(prevFcRef.current)
      ;(map.getSource(PINS_SOURCE)    as GeoJSONSource | undefined)?.setData(pinsFcRef.current)
    }
    map.on('styledata', onStyleData)
    return () => { map.off('styledata', onStyleData) }
  }, [map, mapReady])

  // Rutas guardadas
  useEffect(() => {
    if (!map || !mapReady) return
    const visible = selectedRouteId ? routes.filter(r => r.routeId === selectedRouteId) : []
    const fc = routesToFC(visible)
    fcRef.current = fc
    ;(map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(fc)
  }, [map, mapReady, routes, selectedRouteId])

  // Preview + pins A/B
  useEffect(() => {
    if (!map || !mapReady) return
    const prevFc = previewToFC(previewRoute)
    const pinsFc = pinsToFC(previewRoute)
    prevFcRef.current = prevFc
    pinsFcRef.current = pinsFc
    ;(map.getSource(PREVIEW_SOURCE) as GeoJSONSource | undefined)?.setData(prevFc)
    ;(map.getSource(PINS_SOURCE)    as GeoJSONSource | undefined)?.setData(pinsFc)

    // Hacer zoom para mostrar la ruta completa
    if (previewRoute && previewRoute.geometry.length >= 2) {
      const lngs = previewRoute.geometry.map(p => p[0])
      const lats = previewRoute.geometry.map(p => p[1])
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: { top: 80, bottom: 80, left: 80, right: 380 }, duration: 800 },
      )
    }
  }, [map, mapReady, previewRoute])
}
