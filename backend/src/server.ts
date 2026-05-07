import { createServer } from 'http'
import { createApp } from './app'
import { registerWebSocketServer } from './ws/server'

const PORT = Number(process.env.PORT ?? 3000)

const app = createApp()
const httpServer = createServer(app)

registerWebSocketServer(httpServer)

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`)
})
