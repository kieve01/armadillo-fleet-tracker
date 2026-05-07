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
