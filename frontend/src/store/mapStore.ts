import { create } from 'zustand'
import type { Map } from 'maplibre-gl'

interface MapState {
  map: Map | null
  mapReady: boolean
  setMap: (map: Map) => void
  setReady: (ready: boolean) => void
  clearMap: () => void
}

export const useMapStore = create<MapState>((set) => ({
  map: null,
  mapReady: false,
  setMap: (map) => set({ map }),
  setReady: (mapReady) => set({ mapReady }),
  clearMap: () => set({ map: null, mapReady: false }),
}))
