import { create } from 'zustand'
import * as api from './geofencesService'
import { type Geofence, type GeofenceDraft, type DrawMode, type GeofenceGeometry } from './types'

type Phase = 'idle' | 'drawing' | 'confirming' | 'editing'
const HIDDEN_GEOFENCES_KEY = 'armadillo.hiddenGeofences'

function loadHiddenGeofences(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(HIDDEN_GEOFENCES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, boolean>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveHiddenGeofences(hiddenGeofences: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(HIDDEN_GEOFENCES_KEY, JSON.stringify(hiddenGeofences))
}

interface GeofencesState {
  geofences: Geofence[]
  loading: boolean
  error: string | null
  phase: Phase
  draft: GeofenceDraft | null
  hiddenGeofences: Record<string, boolean>

  fetchGeofences: () => Promise<void>
  startCreate: (mode: DrawMode) => void
  setDraftFeature: (feature: GeoJSON.Feature) => void
  confirmSave: (geofenceId: string) => Promise<void>
  startEdit: (geofence: Geofence) => void
  cancelDraft: () => void
  deleteGeofence: (geofenceId: string) => Promise<void>
  toggleGeofenceVisibility: (geofenceId: string) => void
}

export const useGeofencesStore = create<GeofencesState>((set, get) => ({
  geofences: [],
  loading: false,
  error: null,
  phase: 'idle',
  draft: null,
  hiddenGeofences: loadHiddenGeofences(),

  fetchGeofences: async () => {
    set({ loading: true, error: null })
    try {
      const geofences = await api.listGeofences()
      set({ geofences, loading: false })
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
    }
  },

  startCreate: (mode) => {
    set({ phase: 'drawing', draft: { geofenceId: '', mode, drawnFeature: null } })
  },

  setDraftFeature: (feature) => {
    set((s) => ({
      draft: s.draft ? { ...s.draft, drawnFeature: feature } : null,
      phase: 'confirming',
    }))
  },

  confirmSave: async (geofenceId) => {
    const { draft } = get()
    if (!draft?.drawnFeature) return

    const geometry = featureToGeometry(draft.drawnFeature)
    set({ loading: true, error: null })
    try {
      await api.putGeofence(geofenceId, geometry)
      await get().fetchGeofences()
      set({ phase: 'idle', draft: null })
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
    }
  },

  startEdit: (geofence) => {
    set({
      phase: 'editing',
      draft: {
        geofenceId: geofence.GeofenceId,
        mode: 'Circle' in geofence.Geometry ? 'circle' : 'polygon',
        drawnFeature: null,
      },
    })
  },

  cancelDraft: () => {
    set({ phase: 'idle', draft: null })
  },

  deleteGeofence: async (geofenceId) => {
    set({ loading: true, error: null })
    try {
      await api.deleteGeofence(geofenceId)
      const nextHidden = { ...get().hiddenGeofences }
      delete nextHidden[geofenceId]
      saveHiddenGeofences(nextHidden)
      set({ hiddenGeofences: nextHidden })
      await get().fetchGeofences()
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
    }
  },

  toggleGeofenceVisibility: (geofenceId) => {
    set((state) => {
      const nextHidden = {
        ...state.hiddenGeofences,
        [geofenceId]: !state.hiddenGeofences[geofenceId],
      }
      saveHiddenGeofences(nextHidden)
      return { hiddenGeofences: nextHidden }
    })
  },
}))

function featureToGeometry(feature: GeoJSON.Feature): GeofenceGeometry {
  const props = feature.properties ?? {}

  if (props.isCircle && props.center && props.radiusInKm) {
    return {
      Circle: {
        Center: props.center as [number, number],
        Radius: props.radiusInKm * 1000,
      },
    }
  }

  const geom = feature.geometry as GeoJSON.Polygon
  return { Polygon: geom.coordinates as number[][][] }
}
