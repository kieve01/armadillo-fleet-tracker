import type { Response } from 'express'

export function sendError(res: Response, err: unknown): void {
  console.error(err)
  const message = err instanceof Error ? err.message : 'Internal server error'
  res.status(500).json({ message })
}
