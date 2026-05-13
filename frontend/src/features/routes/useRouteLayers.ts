import { useEffect, useRef } from 'react'
import type { GeoJSONSource, Map } from 'maplibre-gl'
import { useMapStore } from '../../store/mapStore'
import { useRoutesStore } from './routesStore'
import type { RouteResource } from './types'
import type { CalculateRouteResult } from './routesService'

const SOURCE_ID         = 'routes-source'
const LINE_LAYER        = 'routes-line-layer'
const PREVIEW_SOURCE    = 'routes-preview-source'
const PREVIEW_LAYER_BG  = 'routes-preview-bg'    // sombra/outline
const PREVIEW_LAYER     = 'routes-preview-layer' // color principal
const TRAFFIC_SOURCE    = 'routes-traffic-source'
const TRAFFIC_LAYER     = 'routes-traffic-layer' // segmentos de tráfico
const PINS_SOURCE       = 'routes-pins-source'
const PINS_LAYER_CIRCLE = 'routes-pins-circle'
const PINS_LAYER_LABEL  = 'routes-pins-label'

// Colores alternativas: seleccionada=azul, otras=gris
const COLOR_SELECTED = '#1a73e8'  // azul Google Maps / Waze
const COLOR_ALT      = '#9e9e9e'
const COLOR_ALT2     = '#bdbdbd'

// Colores tráfico (igual que Waze/Google Maps)
const COLOR_TRAFFIC_FREE   = '#4caf50'  // verde — fluido
const COLOR_TRAFFIC_SLOW   = '#ff9800'  // naranja — lento
const COLOR_TRAFFIC_JAM    = '#f44336'  // rojo — congestionado

function congestionToColor(c: number): string {
  if (c < 0.3) return COLOR_TRAFFIC_FREE
  if (c < 0.65) return COLOR_TRAFFIC_SLOW
  return COLOR_TRAFFIC_JAM
}

function routesToFC(routes: RouteResource[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes.filter(r => r.geometry.length >= 2).map(r => ({
      type: 'Feature' as const,
      properties: { id: r.routeId },
      geometry: { type: 'LineString' as const, coordinates: r.geometry },
    })),
  }
}

// Todas las rutas (principal + alternativas) en una FeatureCollection
// Las no seleccionadas van primero (debajo), la seleccionada arriba
function allPreviewToFC(
  preview: CalculateRouteResult | null,
  selectedAltIndex: number,
): GeoJSON.FeatureCollection {
  if (!preview) return { type: 'FeatureCollection', features: [] }

  const all = [
    { geom: preview.geometry, idx: 0 },
    ...(preview.alternatives ?? []).map((a, i) => ({ geom: a.geometry, idx: i + 1 })),
  ]

  const sorted = [
    ...all.filter(r => r.idx !== selectedAltIndex),
    ...all.filter(r => r.idx === selectedAltIndex),
  ]

  return {
    type: 'FeatureCollection',
    features: sorted.filter(r => r.geom.length >= 2).map(r => {
      const isSelected = r.idx === selectedAltIndex
      return {
        type: 'Feature' as const,
        properties: {
          selected:  isSelected ? 1 : 0,
          color:     isSelected ? COLOR_SELECTED : (r.idx === 1 ? COLOR_ALT : COLOR_ALT2),
          lineWidth: isSelected ? 6 : 4,
          opacity:   isSelected ? 0.95 : 0.55,
        },
        geometry: { type: 'LineString' as const, coordinates: r.geom },
      }
    }),
  }
}

// Segmentos de tráfico — solo para la ruta seleccionada
function trafficToFC(
  preview: CalculateRouteResult | null,
  selectedAltIndex: number,
): GeoJSON.FeatureCollection {
  if (!preview) return { type: 'FeatureCollection', features: [] }

  const src = selectedAltIndex === 0
    ? {
        geometry:              preview.geometry,
        trafficSpans:          preview.trafficSpans ?? [],
        durationSeconds:       preview.durationSeconds,
        staticDurationSeconds: preview.staticDurationSeconds,
      }
    : (() => {
        const alt = (preview.alternatives ?? [])[selectedAltIndex - 1]
        if (!alt) return null
        return {
          geometry:              alt.geometry,
          trafficSpans:          alt.trafficSpans ?? [],
          durationSeconds:       alt.durationSeconds,
          staticDurationSeconds: alt.staticDurationSeconds,
        }
      })()

  if (!src || src.geometry.length < 2) return { type: 'FeatureCollection', features: [] }

  const features: GeoJSON.Feature[] = []

  if (src.trafficSpans.length > 0) {
    // Datos granulares por segmento: pintar cada uno con su color
    let covered = 0
    const sorted = [...src.trafficSpans].sort((a, b) => a.startIndex - b.startIndex)

    for (const span of sorted) {
      // Gap antes de este span → verde
      if (span.startIndex > covered) {
        const gap = src.geometry.slice(covered, span.startIndex + 1)
        if (gap.length >= 2) features.push({ type: 'Feature', properties: { color: '#4caf50' }, geometry: { type: 'LineString', coordinates: gap } })
      }
      const coords = src.geometry.slice(
        Math.max(0, span.startIndex),
        Math.min(src.geometry.length - 1, span.endIndex) + 1
      )
      if (coords.length >= 2) {
        features.push({ type: 'Feature', properties: { color: congestionToColor(span.congestion) }, geometry: { type: 'LineString', coordinates: coords } })
      }
      covered = Math.max(covered, span.endIndex)
    }
    // Tramo final
    if (covered < src.geometry.length - 1) {
      const tail = src.geometry.slice(covered)
      if (tail.length >= 2) features.push({ type: 'Feature', properties: { color: '#4caf50' }, geometry: { type: 'LineString', coordinates: tail } })
    }
  } else {
    // Sin spans granulares: usar delta duration vs staticDuration para decidir color
    const dur    = src.durationSeconds
    const static_ = src.staticDurationSeconds
    const delta  = dur != null && static_ != null ? dur - static_ : 0
    const delayRatio = static_ != null && static_ > 0 ? delta / static_ : 0

    // delayRatio > 0.3 → +30% más lento → naranja/rojo
    // delayRatio > 0.1 → algo de tráfico → amarillo
    // else → verde (fluido)
    let color: string
    if (delayRatio > 0.3)      color = '#f44336'  // rojo — mucho tráfico
    else if (delayRatio > 0.1) color = '#ff9800'  // naranja — tráfico moderado
    else                       color = '#4caf50'  // verde — fluido

    features.push({
      type: 'Feature',
      properties: { color },
      geometry: { type: 'LineString', coordinates: src.geometry },
    })
  }

  return { type: 'FeatureCollection', features }
}


function pinsToFC(
  preview: CalculateRouteResult | null,
  selectedAltIndex: number,
): GeoJSON.FeatureCollection {
  const src = selectedAltIndex === 0
    ? preview
    : (preview?.alternatives ?? [])[selectedAltIndex - 1]
  if (!src || src.snappedWaypoints.length < 2) return { type: 'FeatureCollection', features: [] }
  const [origin, destination] = src.snappedWaypoints
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { label: 'A' }, geometry: { type: 'Point', coordinates: origin } },
      { type: 'Feature', properties: { label: 'B' }, geometry: { type: 'Point', coordinates: destination } },
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
      paint: { 'line-color': '#f97316', 'line-width': 5, 'line-opacity': 0.9 },
    })
  }

  // Preview: sombra blanca debajo para legibilidad
  if (!map.getSource(PREVIEW_SOURCE)) {
    map.addSource(PREVIEW_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getLayer(PREVIEW_LAYER_BG)) {
    map.addLayer({
      id: PREVIEW_LAYER_BG, type: 'line', source: PREVIEW_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['+', ['get', 'lineWidth'], 3], 'line-opacity': 0.6 },
    })
  }
  if (!map.getLayer(PREVIEW_LAYER)) {
    map.addLayer({
      id: PREVIEW_LAYER, type: 'line', source: PREVIEW_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color':   ['get', 'color'],
        'line-width':   ['get', 'lineWidth'],
        'line-opacity': ['get', 'opacity'],
      },
    })
  }

  // Tráfico — segmentos coloreados encima de la ruta seleccionada
  if (!map.getSource(TRAFFIC_SOURCE)) {
    map.addSource(TRAFFIC_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getLayer(TRAFFIC_LAYER)) {
    map.addLayer({
      id: TRAFFIC_LAYER, type: 'line', source: TRAFFIC_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 5,
        'line-opacity': 0.92,
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
        'circle-radius': 10, 'circle-color': '#1a73e8',
        'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff',
      },
    })
  }
  if (!map.getLayer(PINS_LAYER_LABEL)) {
    map.addLayer({
      id: PINS_LAYER_LABEL, type: 'symbol', source: PINS_SOURCE,
      layout: {
        'text-field': ['get', 'label'], 'text-size': 11,
        'text-font': ['literal', ['Amazon Ember Bold', 'Noto Sans Bold']],
        'text-anchor': 'center',
      },
      paint: { 'text-color': '#ffffff' },
    })
  }
}

export function useRouteLayers() {
  const map              = useMapStore(s => s.map)
  const mapReady         = useMapStore(s => s.mapReady)
  const routes           = useRoutesStore(s => s.routes)
  const selectedRouteId  = useRoutesStore(s => s.selectedRouteId)
  const fetchRoutes      = useRoutesStore(s => s.fetchRoutes)
  const previewRoute     = useRoutesStore(s => s.previewRoute)
  const selectedAltIndex = useRoutesStore(s => s.selectedAltIndex)

  const fcRef       = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })
  const prevFcRef   = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })
  const trafficFcRef = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })
  const pinsFcRef   = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })

  useEffect(() => { if (mapReady) fetchRoutes() }, [mapReady, fetchRoutes])

  useEffect(() => {
    if (!map || !mapReady) return
    addSourceAndLayers(map)
    const onStyleData = () => {
      addSourceAndLayers(map)
      ;(map.getSource(SOURCE_ID)      as GeoJSONSource | undefined)?.setData(fcRef.current)
      ;(map.getSource(PREVIEW_SOURCE) as GeoJSONSource | undefined)?.setData(prevFcRef.current)
      ;(map.getSource(TRAFFIC_SOURCE) as GeoJSONSource | undefined)?.setData(trafficFcRef.current)
      ;(map.getSource(PINS_SOURCE)    as GeoJSONSource | undefined)?.setData(pinsFcRef.current)
    }
    map.on('styledata', onStyleData)
    return () => { map.off('styledata', onStyleData) }
  }, [map, mapReady])

  useEffect(() => {
    if (!map || !mapReady) return
    const visible = selectedRouteId ? routes.filter(r => r.routeId === selectedRouteId) : []
    const fc = routesToFC(visible)
    fcRef.current = fc
    ;(map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(fc)
  }, [map, mapReady, routes, selectedRouteId])

  useEffect(() => {
    if (!map || !mapReady) return

    const prevFc    = allPreviewToFC(previewRoute, selectedAltIndex)
    const trafficFc = trafficToFC(previewRoute, selectedAltIndex)
    const pinsFc    = pinsToFC(previewRoute, selectedAltIndex)

    prevFcRef.current    = prevFc
    trafficFcRef.current = trafficFc
    pinsFcRef.current    = pinsFc

    ;(map.getSource(PREVIEW_SOURCE) as GeoJSONSource | undefined)?.setData(prevFc)
    ;(map.getSource(TRAFFIC_SOURCE) as GeoJSONSource | undefined)?.setData(trafficFc)
    ;(map.getSource(PINS_SOURCE)    as GeoJSONSource | undefined)?.setData(pinsFc)

    // Zoom a la ruta seleccionada
    const activeGeom = selectedAltIndex === 0
      ? previewRoute?.geometry
      : previewRoute?.alternatives?.[selectedAltIndex - 1]?.geometry

    if (activeGeom && activeGeom.length >= 2) {
      const lngs = activeGeom.map(p => p[0])
      const lats  = activeGeom.map(p => p[1])
      // Padding izquierdo grande para dejar espacio al panel
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: { top: 80, bottom: 80, left: 360, right: 80 }, duration: 800 },
      )
    }
  }, [map, mapReady, previewRoute, selectedAltIndex])
}
