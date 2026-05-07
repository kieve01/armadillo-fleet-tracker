import { DeleteOutlined, NodeIndexOutlined } from '@ant-design/icons'
import { Button, Popconfirm, Space, Typography } from 'antd'
import type { KeyboardEvent } from 'react'
import { useState } from 'react'
import { useRoutesStore } from '../routesStore'
import type { RouteResource } from '../types'

interface RouteListItemProps {
  route: RouteResource
  isSelected: boolean
  onSelectRoute: (routeId: string) => void
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return 'Duración no disponible'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (!remainingMinutes) return `${hours} h`

  return `${hours} h ${remainingMinutes} min`
}

function formatDistance(distance: number | null): string {
  if (distance == null) return 'Distancia no disponible'

  if (distance >= 1000) {
    return `${(distance / 1000).toFixed(1)} km`
  }

  return `${Math.round(distance)} m`
}

export default function RouteListItem({ route, isSelected, onSelectRoute }: RouteListItemProps) {
  const removeRoute = useRoutesStore((state) => state.deleteRoute)
  const [deleting, setDeleting] = useState(false)

  const handleSelect = () => {
    onSelectRoute(route.routeId)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleSelect()
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    await removeRoute(route.routeId)
    setDeleting(false)
  }

  return (
    <div
      className={`route-list-item${isSelected ? ' route-list-item--selected' : ''}`}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${isSelected ? 'Deseleccionar' : 'Seleccionar'} ruta ${route.routeId}`}
    >
      <NodeIndexOutlined className="route-list-item__icon" />
      <div className="route-list-item__info">
        <Typography.Text strong ellipsis style={{ maxWidth: 140 }}>
          {route.routeId}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatDistance(route.distance)} · {formatDuration(route.durationSeconds)} · {route.travelMode}
        </Typography.Text>
      </div>
      <Space size={4} onClick={(event) => event.stopPropagation()}>
        <Popconfirm
          title="¿Eliminar ruta?"
          okText="Sí"
          cancelText="No"
          onConfirm={handleDelete}
        >
          <Button size="small" type="text" danger icon={<DeleteOutlined />} loading={deleting} />
        </Popconfirm>
      </Space>
    </div>
  )
}