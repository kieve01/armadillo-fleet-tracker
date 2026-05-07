import * as turf from '@turf/turf'
import MapboxDraw from '@mapbox/mapbox-gl-draw'

// Custom MapboxDraw mode for circle drawing.
// First click = center, second click = edge (determines radius).
// Emits a Polygon feature with { isCircle: true, center, radiusInKm } in properties.

interface CircleModeState {
  polygon: MapboxDraw.DrawPolygon
  center: [number, number] | null
}

const CircleMode: MapboxDraw.DrawCustomMode<CircleModeState> = {
  onSetup() {
    const polygon = this.newFeature({
      type: 'Feature',
      properties: { isCircle: true, center: null, radiusInKm: 0 },
      geometry: { type: 'Polygon', coordinates: [[]] },
    }) as MapboxDraw.DrawPolygon
    this.addFeature(polygon)
    this.clearSelectedFeatures()
    this.setActionableState({ trash: true, combineFeatures: false, uncombineFeatures: false })
    return { polygon, center: null as [number, number] | null }
  },

  onClick(state, e) {
    const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat]

    if (!state.center) {
      state.center = coords
      return
    }

    const radiusInKm = turf.distance(turf.point(state.center), turf.point(coords), { units: 'kilometers' })
    const circle = turf.circle(state.center, radiusInKm, { steps: 64, units: 'kilometers' })

    state.polygon.setProperty('center', state.center)
    state.polygon.setProperty('radiusInKm', radiusInKm)
    state.polygon.incomingCoords(circle.geometry.coordinates)

    this.map.fire('draw.create', { features: [state.polygon.toGeoJSON() as GeoJSON.Feature] })
    this.changeMode('simple_select' as MapboxDraw.DrawMode, { featureIds: [String(state.polygon.id)] })
  },

  onMouseMove(state, e) {
    if (!state.center) return
    const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    const radiusInKm = turf.distance(turf.point(state.center), turf.point(coords), { units: 'kilometers' })
    if (radiusInKm === 0) return
    const circle = turf.circle(state.center, radiusInKm, { steps: 64, units: 'kilometers' })
    state.polygon.incomingCoords(circle.geometry.coordinates)
  },

  onKeyUp(_state, e) {
    if (e.keyCode === 27) this.changeMode('simple_select' as MapboxDraw.DrawMode)
  },

  toDisplayFeatures(_state, geojson, display) {
    display(geojson)
  },

  onStop(state) {
    this.deleteFeature(String(state.polygon.id), { silent: true })
  },
}

export default CircleMode
