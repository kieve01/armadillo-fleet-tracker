import { WebSocket } from 'ws'
import { getConnections } from './wsConnections'

export async function broadcastDevicePosition(payload: Record<string, unknown>): Promise<void> {
  const data = JSON.stringify({ type: 'device_position', payload })
  for (const ws of getConnections().values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  }
}
