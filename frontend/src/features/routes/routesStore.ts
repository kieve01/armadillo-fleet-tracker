import { create } from 'zustand'
import { deleteRoute, listRoutes, putRoute, calculateRoute } from './routesService'
import type { RouteResource, RouteTravelMode } from './types'
import type { CalculateRouteResult } from './routesService'

type Phase = 'idle' | 'drawing' | 'confirming' | 'calculating'

const SELECTED_ROUTE_KEY = 'armadillo.selectedRouteId'

function loadSelectedRouteId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SELECTED_ROUTE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'string' && parsed.length ? parsed : null
  } catch { return null }
}

function saveSelectedRouteId(id: string | null): void {
  if (typeof window === 'undefined') return
  if (!id) { window.localStorage.removeItem(SELECTED_ROUTE_KEY); return }
  window.localStorage.setItem(SELECTED_ROUTE_KEY, JSON.stringify(id))
}

interface RoutesState {
  routes:           RouteResource[]
  loading:          boolean
  error:            string | null
  phase:            Phase
  draftWaypoints:   [number, number][]
  selectedRouteId:  string | null
  previewRoute:     CalculateRouteResult | null
  selectedAltIndex: number

  fetchRoutes:       () => Promise<void>
  startDrawing:      () => void
  addDraftWaypoint:  (point: [number, number]) => void
  undoDraftWaypoint: () => void
  beginConfirmSave:  () => void
  closeConfirm:      () => void
  cancelDraft:       () => void
  saveDraft:         (routeId: string, travelMode: RouteTravelMode) => Promise<void>
  deleteRoute:       (routeId: string) => Promise<void>
  selectRoute:       (routeId: string) => void
  startCalculating:  () => void
  cancelCalculating: () => void
  runCalculate:      (params: {
    origin:      [number, number]
    destination: [number, number]
    travelMode:  RouteTravelMode
    avoidTolls:  boolean
  }) => Promise<void>
  savePreviewRoute:  (routeId: string) => Promise<void>
  clearPreview:      () => void
  selectAltIndex:    (i: number) => void
}

export const useRoutesStore = create<RoutesState>((set, get) => ({
  routes:           [],
  loading:          false,
  error:            null,
  phase:            'idle',
  draftWaypoints:   [],
  selectedRouteId:  loadSelectedRouteId(),
  previewRoute:     null,
  selectedAltIndex: 0,

  fetchRoutes: async () => {
    set({ loading: true, error: null })
    try {
      const routes = await listRoutes()
      const ids    = new Set(routes.map(r => r.routeId))
      const cur    = get().selectedRouteId
      const next   = cur && ids.has(cur) ? cur : null
      saveSelectedRouteId(next)
      set({ routes, loading: false, selectedRouteId: next })
    } catch (err) {
      set({ loading: false, error: (err as Error).message })
    }
  },

  startDrawing:      () => set({ phase: 'drawing', draftWaypoints: [], error: null, previewRoute: null }),
  addDraftWaypoint:  (point) => {
    if (get().phase !== 'drawing') return
    set(s => ({ draftWaypoints: [...s.draftWaypoints, point] }))
  },
  undoDraftWaypoint: () => set(s => ({ draftWaypoints: s.draftWaypoints.slice(0, -1) })),
  beginConfirmSave:  () => {
    if (get().draftWaypoints.length < 2) { set({ error: 'Agrega al menos 2 puntos' }); return }
    set({ phase: 'confirming', error: null })
  },
  closeConfirm:  () => set({ phase: 'drawing' }),
  cancelDraft:   () => set({ phase: 'idle', draftWaypoints: [], error: null }),

  saveDraft: async (routeId, travelMode) => {
    const { draftWaypoints } = get()
    if (draftWaypoints.length < 2) { set({ error: 'Agrega al menos 2 puntos' }); return }
    set({ loading: true, error: null })
    try {
      await putRoute(routeId, { waypoints: draftWaypoints, travelMode })
      await get().fetchRoutes()
      set({ phase: 'idle', draftWaypoints: [] })
    } catch (err) { set({ loading: false, error: (err as Error).message }) }
  },

  deleteRoute: async (routeId) => {
    set({ loading: true, error: null })
    try {
      await deleteRoute(routeId)
      const next = get().selectedRouteId === routeId ? null : get().selectedRouteId
      saveSelectedRouteId(next)
      set({ selectedRouteId: next })
      await get().fetchRoutes()
    } catch (err) { set({ loading: false, error: (err as Error).message }) }
  },

  selectRoute: (routeId) => {
    const next = get().selectedRouteId === routeId ? null : routeId
    saveSelectedRouteId(next)
    set({ selectedRouteId: next })
  },

  startCalculating:  () => set({ phase: 'calculating', error: null, previewRoute: null, selectedAltIndex: 0 }),
  cancelCalculating: () => set({ phase: 'idle', previewRoute: null, error: null, selectedAltIndex: 0 }),

  // Sin departureTime — siempre "ahora" para tráfico real
  runCalculate: async ({ origin, destination, travelMode, avoidTolls }) => {
    set({ loading: true, error: null, previewRoute: null, selectedAltIndex: 0 })
    try {
      const result = await calculateRoute({ waypoints: [origin, destination], travelMode, avoidTolls, alternatives: 3 })
      set({ loading: false, previewRoute: result })
    } catch (err: any) {
      set({ loading: false, error: err.message ?? 'Error al calcular la ruta' })
    }
  },

  savePreviewRoute: async (routeId) => {
    const { previewRoute, selectedAltIndex } = get()
    if (!previewRoute) return
    set({ loading: true, error: null })
    try {
      const alt = selectedAltIndex === 0
        ? previewRoute
        : previewRoute.alternatives[selectedAltIndex - 1]
      await putRoute(routeId, { waypoints: alt.snappedWaypoints, travelMode: previewRoute.travelMode })
      await get().fetchRoutes()
      set({ phase: 'idle', previewRoute: null, selectedAltIndex: 0 })
    } catch (err) { set({ loading: false, error: (err as Error).message }) }
  },

  clearPreview:   () => set({ previewRoute: null, selectedAltIndex: 0 }),
  selectAltIndex: (i) => set({ selectedAltIndex: i }),
}))
