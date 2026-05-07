import { create } from 'zustand'
import { deleteRoute, listRoutes, putRoute } from './routesService'
import type { RouteResource, RouteTravelMode } from './types'

type Phase = 'idle' | 'drawing' | 'confirming'

const SELECTED_ROUTE_KEY = 'armadillo.selectedRouteId'

function loadSelectedRouteId(): string | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(SELECTED_ROUTE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'string' && parsed.length ? parsed : null
  } catch {
    return null
  }
}

function saveSelectedRouteId(selectedRouteId: string | null): void {
  if (typeof window === 'undefined') return
  if (!selectedRouteId) {
    window.localStorage.removeItem(SELECTED_ROUTE_KEY)
    return
  }

  window.localStorage.setItem(SELECTED_ROUTE_KEY, JSON.stringify(selectedRouteId))
}

interface RoutesState {
  routes: RouteResource[]
  loading: boolean
  error: string | null
  phase: Phase
  draftWaypoints: [number, number][]
  selectedRouteId: string | null

  fetchRoutes: () => Promise<void>
  startDrawing: () => void
  addDraftWaypoint: (point: [number, number]) => void
  undoDraftWaypoint: () => void
  beginConfirmSave: () => void
  closeConfirm: () => void
  cancelDraft: () => void
  saveDraft: (routeId: string, travelMode: RouteTravelMode) => Promise<void>
  deleteRoute: (routeId: string) => Promise<void>
  selectRoute: (routeId: string) => void
}

export const useRoutesStore = create<RoutesState>((set, get) => ({
  routes: [],
  loading: false,
  error: null,
  phase: 'idle',
  draftWaypoints: [],
  selectedRouteId: loadSelectedRouteId(),

  fetchRoutes: async () => {
    set({ loading: true, error: null })

    try {
      const routes = await listRoutes()
      const availableIds = new Set(routes.map((route) => route.routeId))
      const currentSelectedRouteId = get().selectedRouteId
      const nextSelectedRouteId = currentSelectedRouteId && availableIds.has(currentSelectedRouteId) ? currentSelectedRouteId : null

      saveSelectedRouteId(nextSelectedRouteId)

      set({ routes, loading: false, selectedRouteId: nextSelectedRouteId })
    } catch (error) {
      set({ loading: false, error: (error as Error).message })
    }
  },

  startDrawing: () => set({ phase: 'drawing', draftWaypoints: [], error: null }),

  addDraftWaypoint: (point) => {
    if (get().phase !== 'drawing') return
    set((state) => ({ draftWaypoints: [...state.draftWaypoints, point] }))
  },

  undoDraftWaypoint: () => {
    set((state) => ({ draftWaypoints: state.draftWaypoints.slice(0, -1) }))
  },

  beginConfirmSave: () => {
    const { draftWaypoints } = get()
    if (draftWaypoints.length < 2) {
      set({ error: 'Agrega al menos 2 puntos para crear la ruta' })
      return
    }

    set({ phase: 'confirming', error: null })
  },

  closeConfirm: () => {
    set({ phase: 'drawing' })
  },

  cancelDraft: () => {
    set({ phase: 'idle', draftWaypoints: [], error: null })
  },

  saveDraft: async (routeId, travelMode) => {
    const { draftWaypoints } = get()

    if (draftWaypoints.length < 2) {
      set({ error: 'Agrega al menos 2 puntos para crear la ruta' })
      return
    }

    set({ loading: true, error: null })

    try {
      await putRoute(routeId, {
        waypoints: draftWaypoints,
        travelMode,
      })

      await get().fetchRoutes()
      set({ phase: 'idle', draftWaypoints: [] })
    } catch (error) {
      set({ loading: false, error: (error as Error).message })
    }
  },

  deleteRoute: async (routeId) => {
    set({ loading: true, error: null })

    try {
      await deleteRoute(routeId)

      const nextSelectedRouteId = get().selectedRouteId === routeId ? null : get().selectedRouteId
      saveSelectedRouteId(nextSelectedRouteId)

      set({ selectedRouteId: nextSelectedRouteId })
      await get().fetchRoutes()
    } catch (error) {
      set({ loading: false, error: (error as Error).message })
    }
  },

  selectRoute: (routeId) => {
    const nextSelectedRouteId = get().selectedRouteId === routeId ? null : routeId
    saveSelectedRouteId(nextSelectedRouteId)
    set({ selectedRouteId: nextSelectedRouteId })
  },
}))