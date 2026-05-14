import { create } from 'zustand'
import * as api from './geofencesService'
import { type Geofence, type GeofenceDraft, type DrawMode, type GeofenceGeometry } from './types'

type Phase = 'idle' | 'drawing' | 'confirming' | 'editing'
const HIDDEN_GEOFENCES_KEY = 'armadillo.hiddenGeofences'

// ── Prefijo: trackerName__geofenceName ───────────────────────────────────────
// Las geocercas se asocian a un tracker mediante un prefijo en el GeofenceId.
// Separador "__" (doble guion bajo) — seguro en AWS Location Service.
const SEP = '__'

export function buildGeofenceId(trackerName: string, name: string): string {
  return `${trackerName}${SEP}${name}`
}

export function parseGeofenceId(geofenceId: string): { trackerName: string; name: string } {
  const idx = geofenceId.indexOf(SEP)
  if (idx === -1) return { trackerName: '', name: geofenceId }
  return { trackerName: geofenceId.slice(0, idx), name: geofenceId.slice(idx + SEP.length) }
}

function loadHiddenGeofences(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(HIDDEN_GEOFENCES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, boolean>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

function saveHiddenGeofences(h: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(HIDDEN_GEOFENCES_KEY, JSON.stringify(h))
}

interface GeofencesState {
  geofences: Geofence[]
  loading: boolean
  error: string | null
  phase: Phase
  draft: GeofenceDraft | null
  hiddenGeofences: Record<string, boolean>

  fetchGeofences: () => Promise<void>
  startCreate: (mode: DrawMode, trackerName: string) => void
  setDraftFeature: (feature: GeoJSON.Feature) => void
  confirmSave: (name: string) => Promise<void>
  startEdit: (geofence: Geofence) => void
  cancelDraft: () => void
  deleteGeofence: (geofenceId: string) => Promise<void>
  toggleGeofenceVisibility: (geofenceId: string) => void
  migrateGeofence: (oldId: string, trackerName: string) => Promise<void>
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

  startCreate: (mode, trackerName) => {
    set({ phase: 'drawing', draft: { geofenceId: '', trackerName, mode, drawnFeature: null } })
  },

  setDraftFeature: (feature) => {
    set(s => ({
      draft: s.draft ? { ...s.draft, drawnFeature: feature } : null,
      phase: 'confirming',
    }))
  },

  confirmSave: async (name) => {
    const { draft } = get()
    if (!draft?.drawnFeature) return
    const fullId   = buildGeofenceId(draft.trackerName, name)
    const geometry = featureToGeometry(draft.drawnFeature)
    set({ loading: true, error: null })
    try {
      await api.putGeofence(fullId, geometry)
      await get().fetchGeofences()
      set({ phase: 'idle', draft: null })
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
    }
  },

  startEdit: (geofence) => {
    const { trackerName } = parseGeofenceId(geofence.GeofenceId)
    set({
      phase: 'editing',
      draft: {
        geofenceId: geofence.GeofenceId,
        trackerName,
        mode: 'Circle' in geofence.Geometry ? 'circle' : 'polygon',
        drawnFeature: null,
      },
    })
  },

  cancelDraft: () => { set({ phase: 'idle', draft: null }) },

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
    set(state => {
      const nextHidden = { ...state.hiddenGeofences, [geofenceId]: !state.hiddenGeofences[geofenceId] }
      saveHiddenGeofences(nextHidden)
      return { hiddenGeofences: nextHidden }
    })
  },

  // Migra una geocerca sin prefijo: la recrea con prefijo y borra la original
  migrateGeofence: async (oldId, trackerName) => {
    const geofence = get().geofences.find(g => g.GeofenceId === oldId)
    if (!geofence) return
    set({ loading: true, error: null })
    try {
      const newId = buildGeofenceId(trackerName, oldId)
      await api.putGeofence(newId, geofence.Geometry)
      await api.deleteGeofence(oldId)
      await get().fetchGeofences()
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
    }
  },
}))

// AWS Location Service requiere orientación counter-clockwise (CCW).
// Fórmula del shoelace: área > 0 → CCW (correcto), área < 0 → CW (invertir).
function shoelaceArea(ring: number[][]): number {
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1])
  }
  return area
}

function ensureCCW(ring: number[][]): number[][] {
  return shoelaceArea(ring) > 0 ? ring : [...ring].reverse()
}

function featureToGeometry(feature: GeoJSON.Feature): GeofenceGeometry {
  const props = feature.properties ?? {}
  if (props.isCircle && props.center && props.radiusInKm) {
    return { Circle: { Center: props.center as [number, number], Radius: props.radiusInKm * 1000 } }
  }
  const geom  = feature.geometry as GeoJSON.Polygon
  const rings = geom.coordinates as number[][][]
  // Anillo exterior siempre CCW, huecos internos CW (invertido)
  const fixed = rings.map((ring, i) => i === 0 ? ensureCCW(ring) : ensureCCW(ring).reverse())
  return { Polygon: fixed }
}
