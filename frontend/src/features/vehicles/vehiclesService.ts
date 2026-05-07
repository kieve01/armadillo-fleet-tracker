import type { TrackerResource, Device } from './types'
import { requestJson, requestVoid, HttpRequestError } from '../../lib/httpClient'

const BASE = import.meta.env.VITE_API_BASE_URL

function toError(error: unknown): Error {
  if (error instanceof HttpRequestError) {
    const detail = error.body ? `: ${error.body}` : ''
    return new Error(`Request failed (${error.status})${detail}`)
  }
  return error instanceof Error ? error : new Error('Unknown API error')
}

export async function listTrackerResources(): Promise<TrackerResource[]> {
  try {
    const entries = await requestJson<Array<Record<string, string>>>(`${BASE}/api/trackers`, { retries: 2 })
    return entries.map((e) => ({
      trackerName: e.TrackerName,
      description: e.Description,
      createTime: e.CreateTime,
      updateTime: e.UpdateTime,
    }))
  } catch (error) {
    throw toError(error)
  }
}

export async function createTrackerResource(trackerName: string, description?: string): Promise<void> {
  try {
    await requestVoid(`${BASE}/api/trackers`, {
      method: 'POST',
      body: JSON.stringify({ trackerName, description }),
    })
  } catch (error) {
    throw toError(error)
  }
}

export async function deleteTrackerResource(trackerName: string): Promise<void> {
  try {
    await requestVoid(`${BASE}/api/trackers/${encodeURIComponent(trackerName)}`, {
      method: 'DELETE',
    })
  } catch (error) {
    throw toError(error)
  }
}

export async function deleteDeviceResource(trackerName: string, deviceId: string): Promise<void> {
  try {
    await requestVoid(
      `${BASE}/api/trackers/${encodeURIComponent(trackerName)}/devices/${encodeURIComponent(deviceId)}`,
      {
        method: 'DELETE',
      },
    )
  } catch (error) {
    throw toError(error)
  }
}

export async function listDevices(trackerName: string): Promise<Device[]> {
  try {
    const entries = await requestJson<Array<Omit<Device, 'trackerName'>>>(
      `${BASE}/api/trackers/${encodeURIComponent(trackerName)}/devices`,
      { retries: 2 },
    )
    return entries.map((d) => ({ ...d, trackerName }))
  } catch (error) {
    throw toError(error)
  }
}

export async function updateDeviceLocation(
  trackerName: string,
  deviceId: string,
  lat: number,
  lng: number,
): Promise<void> {
  try {
    await requestVoid(
      `${BASE}/api/trackers/${encodeURIComponent(trackerName)}/devices/${encodeURIComponent(deviceId)}/location`,
      {
      method: 'POST',
      body: JSON.stringify({ lat, lng }),
    },
    )
  } catch (error) {
    throw toError(error)
  }
}
