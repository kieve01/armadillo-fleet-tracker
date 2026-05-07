import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'

const ROUTES_TABLE = process.env.ROUTES_TABLE

const dbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

export type RouteTravelMode = 'Car' | 'Truck' | 'Walking'

export interface RouteRecord {
  routeId: string
  waypoints: [number, number][]
  geometry: [number, number][]
  travelMode: RouteTravelMode
  distance: number | null
  durationSeconds: number | null
  createdAt: string
  updatedAt: string
}

function getRoutesTableName(): string {
  if (!ROUTES_TABLE) {
    throw new Error('ROUTES_TABLE is not configured')
  }

  return ROUTES_TABLE
}

export async function listRoutes(): Promise<RouteRecord[]> {
  const routes: RouteRecord[] = []
  let lastEvaluatedKey: Record<string, unknown> | undefined

  do {
    const result = await dbClient.send(
      new ScanCommand({
        TableName: getRoutesTableName(),
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    )

    for (const item of result.Items ?? []) {
      if (isRouteRecord(item)) {
        routes.push(item)
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey
  } while (lastEvaluatedKey)

  return routes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getRoute(routeId: string): Promise<RouteRecord | null> {
  const result = await dbClient.send(
    new GetCommand({
      TableName: getRoutesTableName(),
      Key: { routeId },
    }),
  )

  if (!result.Item || !isRouteRecord(result.Item)) {
    return null
  }

  return result.Item
}

export async function putRoute(route: RouteRecord): Promise<void> {
  await dbClient.send(
    new PutCommand({
      TableName: getRoutesTableName(),
      Item: route,
    }),
  )
}

export async function deleteRoute(routeId: string): Promise<void> {
  await dbClient.send(
    new DeleteCommand({
      TableName: getRoutesTableName(),
      Key: { routeId },
    }),
  )
}

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'number'
    && Number.isFinite(value[0])
    && typeof value[1] === 'number'
    && Number.isFinite(value[1])
  )
}

function isRouteRecord(value: unknown): value is RouteRecord {
  if (!value || typeof value !== 'object') return false

  const record = value as Partial<RouteRecord>

  return (
    typeof record.routeId === 'string'
    && Array.isArray(record.waypoints)
    && record.waypoints.every(isCoordinate)
    && Array.isArray(record.geometry)
    && record.geometry.every(isCoordinate)
    && (record.travelMode === 'Car' || record.travelMode === 'Truck' || record.travelMode === 'Walking')
    && (record.distance === null || typeof record.distance === 'number')
    && (record.durationSeconds === null || typeof record.durationSeconds === 'number')
    && typeof record.createdAt === 'string'
    && typeof record.updatedAt === 'string'
  )
}