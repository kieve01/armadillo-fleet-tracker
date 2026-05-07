import { useEffect, useRef } from 'react'
import * as turf from '@turf/turf'
import type { Map } from 'maplibre-gl'
import { useMapStore } from '../../store/mapStore'
import { useGeofencesStore } from './geofencesStore'
import type { Geofence } from './types'

const SOURCE_ID = 'geofences-source'
const FILL_LAYER = 'geofences-fill'
const LINE_LAYER = 'geofences-outline'

function geofencesToFC(geofences: Geofence[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geofences.map((g) => {
      const props = { id: g.GeofenceId }
      if ('Circle' in g.Geometry) {
        const { Center, Radius } = g.Geometry.Circle
        return turf.circle(Center, Radius, { steps: 64, units: 'meters', properties: props })
      }
      return {
        type: 'Feature' as const,
        properties: props,
        geometry: { type: 'Polygon' as const, coordinates: g.Geometry.Polygon },
      }
    }),
  }
}

function addSourceAndLayers(map: Map) {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getLayer(FILL_LAYER)) {
    map.addLayer({
      id: FILL_LAYER,
      type: 'fill',
      source: SOURCE_ID,
      paint: { 'fill-color': '#00418b', 'fill-opacity': 0.15 },
    })
  }
  if (!map.getLayer(LINE_LAYER)) {
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: SOURCE_ID,
      paint: { 'line-color': '#00418b', 'line-width': 2 },
    })
  }
}

export function useGeofenceLayers() {
  const map = useMapStore((s) => s.map)
  const mapReady = useMapStore((s) => s.mapReady)
  const geofences = useGeofencesStore((s) => s.geofences)
  const hiddenGeofences = useGeofencesStore((s) => s.hiddenGeofences)
  const fetchGeofences = useGeofencesStore((s) => s.fetchGeofences)
  const fcRef = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })

  // Initial fetch
  useEffect(() => {
    if (mapReady) fetchGeofences()
  }, [mapReady, fetchGeofences])

  // Add source/layers and re-add after style changes (e.g. traffic toggle)
  useEffect(() => {
    if (!map || !mapReady) return

    addSourceAndLayers(map)

    const onStyleData = () => {
      addSourceAndLayers(map)
      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
      src?.setData(fcRef.current)
    }

    map.on('styledata', onStyleData)
    return () => { map.off('styledata', onStyleData) }
  }, [map, mapReady])

  // Update features whenever geofences change
  useEffect(() => {
    if (!map || !mapReady) return
    const visibleGeofences = geofences.filter((g) => !hiddenGeofences[g.GeofenceId])
    const fc = geofencesToFC(visibleGeofences)
    fcRef.current = fc
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    src?.setData(fc)
  }, [map, mapReady, geofences, hiddenGeofences])
}
