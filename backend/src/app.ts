import express from 'express'
import { registerGeofenceRoutes } from './modules/geofences/routes'
import { registerRouteRoutes } from './modules/routes/routes'
import { registerTrackerRoutes } from './modules/trackers/routes'

export function createApp(): express.Express {
  const app = express()

  app.use(express.json())
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,PATCH,HEAD')
    next()
  })
  app.options('*', (_req, res) => { res.sendStatus(204) })

  app.get('/health', (_req, res) => { res.json({ status: 'ok' }) })

  registerGeofenceRoutes(app)
  registerRouteRoutes(app)
  registerTrackerRoutes(app)

  return app
}
