export interface TrackerResource {
  trackerName: string
  description?: string
  createTime?: string
  updateTime?: string
}

export interface Device {
  deviceId: string
  trackerName: string
  lat: number
  lng: number
  speed: number | null
  heading: number | null
  updatedAt: string
}

export interface DeviceGroup {
  id: string
  name: string
}

export interface TrackerMeta {
  trackerName: string
  displayName: string
  groups: DeviceGroup[]
  deviceGroups: Record<string, string>  // deviceId → groupId
}
