import { randomUUID } from 'crypto'
import type { Server } from 'http'
import { WebSocketServer } from 'ws'
import { addConnection, removeConnection } from '../lib/wsConnections'

export function registerWebSocketServer(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws) => {
    const connectionId = randomUUID()
    addConnection(connectionId, ws)
    ws.on('close', () => removeConnection(connectionId))
    ws.on('error', () => removeConnection(connectionId))
  })
}
