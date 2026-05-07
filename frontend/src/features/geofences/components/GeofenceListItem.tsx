import { useState } from 'react'
import { Button, Popconfirm, Space, Typography } from 'antd'
import { EditOutlined, DeleteOutlined, EnvironmentOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons'
import type { Geofence } from '../types'
import { useGeofencesStore } from '../geofencesStore'

interface Props {
  geofence: Geofence
  onEdit: (geofence: Geofence) => void
  isHidden: boolean
  onToggleVisibility: (geofenceId: string) => void
}

export default function GeofenceListItem({ geofence, onEdit, isHidden, onToggleVisibility }: Props) {
  const deleteGeofence = useGeofencesStore((s) => s.deleteGeofence)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    await deleteGeofence(geofence.GeofenceId)
    setDeleting(false)
  }

  const subtitle = 'Circle' in geofence.Geometry
    ? `Círculo · ${Math.round(geofence.Geometry.Circle.Radius)} m`
    : 'Polígono'

  return (
    <div className={`geofence-list-item${isHidden ? ' geofence-list-item--hidden' : ''}`}>
      <EnvironmentOutlined className="geofence-list-item__icon" />
      <div className="geofence-list-item__info">
        <Typography.Text strong ellipsis style={{ maxWidth: 130 }}>
          {geofence.GeofenceId}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {subtitle}
        </Typography.Text>
      </div>
      <Space size={4}>
        <Button
          size="small"
          type="text"
          icon={isHidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          onClick={() => onToggleVisibility(geofence.GeofenceId)}
        />
        <Button
          size="small"
          type="text"
          icon={<EditOutlined />}
          onClick={() => onEdit(geofence)}
        />
        <Popconfirm
          title="¿Eliminar geocerca?"
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
