import { create } from 'zustand'
import {
  listTrackerResources,
  createTrackerResource,
  deleteTrackerResource,
  deleteDeviceResource,
  listDevices,
  updateDeviceLocation,
} from './vehiclesService'
import type { TrackerResource, Device } from './types'

type Phase = 'idle' | 'placing'

interface PendingLocation {
  lat: number
  lng: number
}

interface DevicePositionEvent {
  trackerName: string
  deviceId: string
  lat: number
  lng: number
  speed: number | null
  heading: number | null
  updatedAt: string
}

interface VehiclesState {
  trackerResources: TrackerResource[]
  devices: Device[]
  loading: boolean
  error: string | null
  selectedDeviceId: string | null
  phase: Phase
  pendingLocation: PendingLocation | null
  collapsedTrackers: Record<string, boolean>
  hiddenTrackers: Record<string, boolean>
  hiddenDevices: Record<string, boolean>

  fetchAll: () => Promise<void>
  createTracker: (trackerName: string, description?: string) => Promise<void>
  deleteTracker: (trackerName: string) => Promise<void>
  deleteDevice: (trackerName: string, deviceId: string) => Promise<void>

  startPlace: () => void
  setPendingLocation: (loc: PendingLocation) => void
  confirmPlaceDevice: (trackerName: string, deviceId: string) => Promise<void>
  cancelPlace: () => void

  selectDevice: (id: string | null) => void
  upsertDevicePosition: (event: DevicePositionEvent) => void
  toggleTrackerCollapsed: (trackerName: string) => void
  toggleTrackerVisibility: (trackerName: string) => void
  toggleDeviceVisibility: (trackerName: string, deviceId: string) => void
}

export const useVehiclesStore = create<VehiclesState>((set, get) => ({
  trackerResources: [],
  devices: [],
  loading: false,
  error: null,
  selectedDeviceId: null,
  phase: 'idle',
  pendingLocation: null,
  collapsedTrackers: {},
  hiddenTrackers: {},
  hiddenDevices: {},

  fetchAll: async () => {
    set({ loading: true, error: null })
    try {
      const resources = await listTrackerResources()
      const allDevices = (
        await Promise.all(resources.map((r) => listDevices(r.trackerName).catch(() => [])))
      ).flat()
      set({ trackerResources: resources, devices: allDevices, loading: false })
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
    }
  },

  createTracker: async (trackerName, description) => {
    set({ loading: true, error: null })
    try {
      await createTrackerResource(trackerName, description)
      await get().fetchAll()
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
    }
  },

  deleteTracker: async (trackerName) => {
    set({ loading: true, error: null })
    try {
      await deleteTrackerResource(trackerName)
      await get().fetchAll()
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
    }
  },

  deleteDevice: async (trackerName, deviceId) => {
    set({ loading: true, error: null })
    try {
      await deleteDeviceResource(trackerName, deviceId)
      await get().fetchAll()
      if (get().selectedDeviceId === deviceId) {
        set({ selectedDeviceId: null })
      }
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
    }
  },

  startPlace: () => set({ phase: 'placing', pendingLocation: null, error: null }),

  setPendingLocation: (loc) => set({ pendingLocation: loc }),

  confirmPlaceDevice: async (trackerName, deviceId) => {
    const { pendingLocation } = get()
    if (!pendingLocation) return
    set({ loading: true, error: null })
    try {
      await updateDeviceLocation(trackerName, deviceId, pendingLocation.lat, pendingLocation.lng)
      await get().fetchAll()
      set({ phase: 'idle', pendingLocation: null })
    } catch (e) {
      set({ loading: false, error: (e as Error).message })
    }
  },

  cancelPlace: () => set({ phase: 'idle', pendingLocation: null, error: null }),

  selectDevice: (id) => set({ selectedDeviceId: id }),

  upsertDevicePosition: (event) => {
    set((state) => {
      const nextDevices = [...state.devices]
      const index = nextDevices.findIndex(
        (d) => d.deviceId === event.deviceId && d.trackerName === event.trackerName,
      )

      const device: Device = {
        deviceId: event.deviceId,
        trackerName: event.trackerName,
        lat: event.lat,
        lng: event.lng,
        speed: event.speed,
        heading: event.heading,
        updatedAt: event.updatedAt,
      }

      if (index >= 0) {
        nextDevices[index] = device
      } else {
        nextDevices.push(device)
      }

      return { devices: nextDevices }
    })
  },

  toggleTrackerCollapsed: (trackerName) => {
    set((state) => ({
      collapsedTrackers: {
        ...state.collapsedTrackers,
        [trackerName]: !state.collapsedTrackers[trackerName],
      },
    }))
  },

  toggleTrackerVisibility: (trackerName) => {
    set((state) => ({
      hiddenTrackers: {
        ...state.hiddenTrackers,
        [trackerName]: !state.hiddenTrackers[trackerName],
      },
    }))
  },

  toggleDeviceVisibility: (trackerName, deviceId) => {
    const key = `${trackerName}/${deviceId}`
    set((state) => ({
      hiddenDevices: {
        ...state.hiddenDevices,
        [key]: !state.hiddenDevices[key],
      },
    }))
  },
}))
