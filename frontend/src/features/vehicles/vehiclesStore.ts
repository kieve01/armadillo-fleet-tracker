import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  listTrackerResources,
  createTrackerResource,
  deleteTrackerResource,
  deleteDeviceResource,
  listDevices,
  updateDeviceLocation,
  listTrackerMeta,
  putTrackerMeta,
} from './vehiclesService'
import type { TrackerResource, Device, TrackerMeta, DeviceGroup } from './types'

export type FollowMode = 'none' | 'overview' | 'navigation'

type Phase = 'idle' | 'placing'

interface PendingLocation { lat: number; lng: number }

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
  trackerMeta: Record<string, TrackerMeta>
  loading: boolean
  error: string | null
  selectedDeviceId: string | null
  followTrackerName: string | null
  followMode: FollowMode
  phase: Phase
  pendingLocation: PendingLocation | null
  collapsedTrackers: Record<string, boolean>
  collapsedGroups: Record<string, boolean>
  hiddenTrackers: Record<string, boolean>
  hiddenGroups: Record<string, boolean>
  hiddenDevices: Record<string, boolean>

  fetchAll: () => Promise<void>
  createTracker: (trackerName: string, description?: string) => Promise<void>
  deleteTracker: (trackerName: string) => Promise<void>
  deleteDevice: (trackerName: string, deviceId: string) => Promise<void>

  // Meta — stored in localStorage only
  createGroup: (trackerName: string, groupName: string) => string
  setDeviceOrder: (trackerName: string, order: string[]) => void
  renameGroup: (trackerName: string, groupId: string, newName: string) => void
  deleteGroup: (trackerName: string, groupId: string) => void
  assignDeviceToGroup: (trackerName: string, deviceId: string, groupId: string | null) => void

  // Follow
  setFollow: (deviceId: string | null, trackerName: string | null, mode: FollowMode) => void
  setFollowMode: (mode: FollowMode) => void

  startPlace: () => void
  setPendingLocation: (loc: PendingLocation) => void
  confirmPlaceDevice: (trackerName: string, deviceId: string) => Promise<void>
  cancelPlace: () => void

  selectDevice: (id: string | null) => void
  upsertDevicePosition: (event: DevicePositionEvent) => void
  toggleTrackerCollapsed: (trackerName: string) => void
  toggleGroupCollapsed: (trackerName: string, groupId: string) => void
  toggleTrackerVisibility: (trackerName: string) => void
  toggleGroupVisibility: (trackerName: string, groupId: string) => void
  toggleDeviceVisibility: (trackerName: string, deviceId: string) => void
}

function generateGroupId(): string {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export const useVehiclesStore = create<VehiclesState>()(
  persist(
    (set, get) => ({
      trackerResources: [],
      devices: [],
      trackerMeta: {},
      loading: false,
      error: null,
      selectedDeviceId: null,
      followTrackerName: null,
      followMode: 'none',
      phase: 'idle',
      pendingLocation: null,
      collapsedTrackers: {},
      collapsedGroups: {},
      hiddenTrackers: {},
      hiddenGroups: {},
      hiddenDevices: {},

      fetchAll: async () => {
        set({ loading: true, error: null })
        try {
          const resources = await listTrackerResources()
          const [allDevicesNested, allMeta] = await Promise.all([
            Promise.all(resources.map((r) => listDevices(r.trackerName).catch(() => []))),
            Promise.all(resources.map((r) =>
              listTrackerMeta(r.trackerName).catch((): TrackerMeta => ({
                trackerName: r.trackerName,
                displayName: r.trackerName,
                groups: [],
                deviceGroups: {},
              }))
            )),
          ])
          const trackerMeta: Record<string, TrackerMeta> = {}
          for (const meta of allMeta) {
            trackerMeta[meta.trackerName] = meta
          }
          set({ trackerResources: resources, devices: allDevicesNested.flat(), trackerMeta, loading: false })
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
          if (get().selectedDeviceId === deviceId) set({ selectedDeviceId: null })
        } catch (e) {
          set({ loading: false, error: (e as Error).message })
        }
      },

      // ── Meta (DynamoDB via API — shared across all machines) ─────────────

      createGroup: (trackerName, groupName) => {
        const current = get().trackerMeta[trackerName] ?? { trackerName, displayName: trackerName, groups: [], deviceGroups: {} }
        const newGroup: DeviceGroup = { id: generateGroupId(), name: groupName }
        const updated: TrackerMeta = { ...current, groups: [...current.groups, newGroup] }
        set((s) => ({ trackerMeta: { ...s.trackerMeta, [trackerName]: updated } }))
        putTrackerMeta(trackerName, updated).catch(console.error)
        return newGroup.id
      },

      renameGroup: (trackerName, groupId, newName) => {
        const current = get().trackerMeta[trackerName] ?? { trackerName, displayName: trackerName, groups: [], deviceGroups: {} }
        const updated: TrackerMeta = {
          ...current,
          groups: current.groups.map((g) => g.id === groupId ? { ...g, name: newName } : g),
        }
        set((s) => ({ trackerMeta: { ...s.trackerMeta, [trackerName]: updated } }))
        putTrackerMeta(trackerName, updated).catch(console.error)
      },

      deleteGroup: (trackerName, groupId) => {
        const current = get().trackerMeta[trackerName] ?? { trackerName, displayName: trackerName, groups: [], deviceGroups: {} }
        const deviceGroups = { ...current.deviceGroups }
        for (const [deviceId, gId] of Object.entries(deviceGroups)) {
          if (gId === groupId) delete deviceGroups[deviceId]
        }
        const updated: TrackerMeta = {
          ...current,
          groups: current.groups.filter((g) => g.id !== groupId),
          deviceGroups,
        }
        set((s) => ({ trackerMeta: { ...s.trackerMeta, [trackerName]: updated } }))
        putTrackerMeta(trackerName, updated).catch(console.error)
      },

      assignDeviceToGroup: (trackerName, deviceId, groupId) => {
        const current = get().trackerMeta[trackerName] ?? { trackerName, displayName: trackerName, groups: [], deviceGroups: {} }
        const deviceGroups = { ...current.deviceGroups }
        if (groupId === null) delete deviceGroups[deviceId]
        else deviceGroups[deviceId] = groupId
        const updated: TrackerMeta = { ...current, deviceGroups }
        set((s) => ({ trackerMeta: { ...s.trackerMeta, [trackerName]: updated } }))
        putTrackerMeta(trackerName, updated).catch(console.error)
      },

      setDeviceOrder: (trackerName, order) => {
        const current = get().trackerMeta[trackerName] ?? { trackerName, displayName: trackerName, groups: [], deviceGroups: {} }
        const updated: TrackerMeta = { ...current, deviceOrder: order }
        set((s) => ({ trackerMeta: { ...s.trackerMeta, [trackerName]: updated } }))
        putTrackerMeta(trackerName, updated).catch(console.error)
      },

      // ── Follow ────────────────────────────────────────────────────────────

      setFollow: (deviceId, trackerName, mode) => {
        set({ selectedDeviceId: deviceId, followTrackerName: trackerName, followMode: mode })
      },

      setFollowMode: (mode) => {
        // navigation → overview keeps the selected device
        // overview → none clears selection
        if (mode === 'none') {
          set({ followMode: 'none', selectedDeviceId: null, followTrackerName: null })
        } else {
          set({ followMode: mode })
        }
      },

      // ── Place ─────────────────────────────────────────────────────────────

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
          if (index >= 0) nextDevices[index] = device
          else nextDevices.push(device)
          return { devices: nextDevices }
        })
      },

      toggleTrackerCollapsed: (trackerName) => {
        set((s) => ({
          collapsedTrackers: { ...s.collapsedTrackers, [trackerName]: !s.collapsedTrackers[trackerName] },
        }))
      },

      toggleGroupCollapsed: (trackerName, groupId) => {
        const key = `${trackerName}/${groupId}`
        set((s) => ({ collapsedGroups: { ...s.collapsedGroups, [key]: !s.collapsedGroups[key] } }))
      },

      toggleTrackerVisibility: (trackerName) => {
        set((s) => ({
          hiddenTrackers: { ...s.hiddenTrackers, [trackerName]: !s.hiddenTrackers[trackerName] },
        }))
      },

      toggleGroupVisibility: (trackerName, groupId) => {
        const key = `${trackerName}/${groupId}`
        set((s) => ({ hiddenGroups: { ...s.hiddenGroups, [key]: !s.hiddenGroups[key] } }))
      },

      toggleDeviceVisibility: (trackerName, deviceId) => {
        const key = `${trackerName}/${deviceId}`
        set((s) => ({ hiddenDevices: { ...s.hiddenDevices, [key]: !s.hiddenDevices[key] } }))
      },
    }),
    {
      name: 'armadillo-vehicles-ui',
      partialize: (s) => ({
        collapsedTrackers: s.collapsedTrackers,
        collapsedGroups:   s.collapsedGroups,
        hiddenTrackers:    s.hiddenTrackers,
        hiddenGroups:      s.hiddenGroups,
        hiddenDevices:     s.hiddenDevices,
      }),
    }
  )
)
