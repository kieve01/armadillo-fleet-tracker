import type { WebSocket } from 'ws'

const connections = new Map<string, WebSocket>()

export function addConnection(connectionId: string, ws: WebSocket): void {
  connections.set(connectionId, ws)
}

export function removeConnection(connectionId: string): void {
  connections.delete(connectionId)
}

export function getConnections(): ReadonlyMap<string, WebSocket> {
  return connections
}
