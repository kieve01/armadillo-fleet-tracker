import { useEffect, useRef } from 'react'
import type { GeoJSONSource, Map } from 'maplibre-gl'
import { useMapStore } from '../../store/mapStore'
import { useRoutesStore } from './routesStore'
import type { RouteResource } from './types'

const SOURCE_ID = 'routes-source'
const LINE_LAYER = 'routes-line-layer'

function routesToFeatureCollection(routes: RouteResource[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((route) => route.geometry.length >= 2)
      .map((route) => ({
        type: 'Feature' as const,
        properties: {
          id: route.routeId,
          travelMode: route.travelMode,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: route.geometry,
        },
      })),
  }
}

function addSourceAndLayers(map: Map): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }

  if (!map.getLayer(LINE_LAYER)) {
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: SOURCE_ID,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#f97316',
        'line-width': 4,
        'line-opacity': 0.9,
      },
    })
  }
}

export function useRouteLayers() {
  const map = useMapStore((state) => state.map)
  const mapReady = useMapStore((state) => state.mapReady)
  const routes = useRoutesStore((state) => state.routes)
  const selectedRouteId = useRoutesStore((state) => state.selectedRouteId)
  const fetchRoutes = useRoutesStore((state) => state.fetchRoutes)
  const fcRef = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })

  useEffect(() => {
    if (mapReady) {
      fetchRoutes()
    }
  }, [mapReady, fetchRoutes])

  useEffect(() => {
    if (!map || !mapReady) return

    addSourceAndLayers(map)

    const onStyleData = () => {
      addSourceAndLayers(map)
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
      source?.setData(fcRef.current)
    }

    map.on('styledata', onStyleData)

    return () => {
      map.off('styledata', onStyleData)
    }
  }, [map, mapReady])

  useEffect(() => {
    if (!map || !mapReady) return

    const visibleRoutes = selectedRouteId ? routes.filter((route) => route.routeId === selectedRouteId) : []
    const featureCollection = routesToFeatureCollection(visibleRoutes)
    fcRef.current = featureCollection

    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(featureCollection)
  }, [map, mapReady, routes, selectedRouteId])
}