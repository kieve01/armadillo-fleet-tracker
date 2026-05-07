import { useEffect } from 'react'
import type { GeoJSONSource, Map, MapMouseEvent } from 'maplibre-gl'
import { useMapStore } from '../../store/mapStore'
import { useRoutesStore } from './routesStore'

const DRAFT_LINE_SOURCE = 'route-draft-line-source'
const DRAFT_POINTS_SOURCE = 'route-draft-points-source'
const DRAFT_LINE_LAYER = 'route-draft-line-layer'
const DRAFT_POINTS_LAYER = 'route-draft-points-layer'

function addDraftSourcesAndLayers(map: Map): void {
  if (!map.getSource(DRAFT_LINE_SOURCE)) {
    map.addSource(DRAFT_LINE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }

  if (!map.getSource(DRAFT_POINTS_SOURCE)) {
    map.addSource(DRAFT_POINTS_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }

  if (!map.getLayer(DRAFT_LINE_LAYER)) {
    map.addLayer({
      id: DRAFT_LINE_LAYER,
      type: 'line',
      source: DRAFT_LINE_SOURCE,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#f59e0b',
        'line-width': 3,
        'line-dasharray': [2, 2],
      },
    })
  }

  if (!map.getLayer(DRAFT_POINTS_LAYER)) {
    map.addLayer({
      id: DRAFT_POINTS_LAYER,
      type: 'circle',
      source: DRAFT_POINTS_SOURCE,
      paint: {
        'circle-radius': 5,
        'circle-color': '#f59e0b',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })
  }
}

function toDraftLineFeatureCollection(points: [number, number][]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.length >= 2
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points } }]
      : [],
  }
}

function toDraftPointsFeatureCollection(points: [number, number][]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((point, index) => ({
      type: 'Feature',
      properties: { index },
      geometry: { type: 'Point', coordinates: point },
    })),
  }
}

export function useRouteDraw() {
  const map = useMapStore((state) => state.map)
  const mapReady = useMapStore((state) => state.mapReady)
  const phase = useRoutesStore((state) => state.phase)
  const draftWaypoints = useRoutesStore((state) => state.draftWaypoints)
  const addDraftWaypoint = useRoutesStore((state) => state.addDraftWaypoint)
  const beginConfirmSave = useRoutesStore((state) => state.beginConfirmSave)

  useEffect(() => {
    if (!map || !mapReady) return

    addDraftSourcesAndLayers(map)

    const onStyleData = () => {
      addDraftSourcesAndLayers(map)

      const lineSource = map.getSource(DRAFT_LINE_SOURCE) as GeoJSONSource | undefined
      lineSource?.setData(toDraftLineFeatureCollection(draftWaypoints))

      const pointsSource = map.getSource(DRAFT_POINTS_SOURCE) as GeoJSONSource | undefined
      pointsSource?.setData(toDraftPointsFeatureCollection(draftWaypoints))
    }

    map.on('styledata', onStyleData)

    return () => {
      map.off('styledata', onStyleData)
    }
  }, [map, mapReady, draftWaypoints])

  useEffect(() => {
    if (!map || !mapReady) return

    const lineSource = map.getSource(DRAFT_LINE_SOURCE) as GeoJSONSource | undefined
    lineSource?.setData(toDraftLineFeatureCollection(draftWaypoints))

    const pointsSource = map.getSource(DRAFT_POINTS_SOURCE) as GeoJSONSource | undefined
    pointsSource?.setData(toDraftPointsFeatureCollection(draftWaypoints))
  }, [map, mapReady, draftWaypoints])

  useEffect(() => {
    if (!map || !mapReady) return

    const canvas = map.getCanvas()

    if (phase !== 'drawing') {
      canvas.style.cursor = ''
      map.doubleClickZoom.enable()
      return
    }

    canvas.style.cursor = 'crosshair'
    map.doubleClickZoom.disable()

    const onClick = (event: MapMouseEvent) => {
      addDraftWaypoint([event.lngLat.lng, event.lngLat.lat])
    }

    const onDoubleClick = (event: MapMouseEvent) => {
      event.preventDefault()
      beginConfirmSave()
    }

    map.on('click', onClick)
    map.on('dblclick', onDoubleClick)

    return () => {
      map.off('click', onClick)
      map.off('dblclick', onDoubleClick)
      canvas.style.cursor = ''
      map.doubleClickZoom.enable()
    }
  }, [map, mapReady, phase, addDraftWaypoint, beginConfirmSave])
}