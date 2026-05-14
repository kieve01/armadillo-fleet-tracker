import { useState } from 'react'
import { Button, Popconfirm, Space, Typography } from 'antd'
import { EditOutlined, DeleteOutlined, EnvironmentOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons'
import type { Geofence } from '../types'
import { useGeofencesStore } from '../geofencesStore'
import { useMapStore } from '../../../store/mapStore'
import * as turf from '@turf/turf'

interface Props {
  geofence: Geofence
  onEdit: (geofence: Geofence) => void
  isHidden: boolean
  onToggleVisibility: (geofenceId: string) => void
}

function getGeofenceCenter(geofence: Geofence): [number, number] | null {
  if ('Circle' in geofence.Geometry) {
    return geofence.Geometry.Circle.Center
  }
  if ('Polygon' in geofence.Geometry) {
    const coords = geofence.Geometry.Polygon[0]
    if (!coords?.length) return null
    const feature = turf.polygon(geofence.Geometry.Polygon)
    const center  = turf.centroid(feature)
    return center.geometry.coordinates as [number, number]
  }
  return null
}

export default function GeofenceListItem({ geofence, onEdit, isHidden, onToggleVisibility }: Props) {
  const deleteGeofence = useGeofencesStore((s) => s.deleteGeofence)
  const map            = useMapStore((s) => s.map)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    await deleteGeofence(geofence.GeofenceId)
    setDeleting(false)
  }

  const handleFlyTo = () => {
    if (!map) return
    const center = getGeofenceCenter(geofence)
    if (!center) return

    if ('Circle' in geofence.Geometry) {
      const radiusKm = geofence.Geometry.Circle.Radius / 1000
      // Zoom level that fits the circle
      const zoom = Math.max(10, Math.min(16, 14 - Math.log2(radiusKm)))
      map.flyTo({ center, zoom })
    } else {
      const coords = geofence.Geometry.Polygon[0]
      const lngs   = coords.map(c => c[0])
      const lats   = coords.map(c => c[1])
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 60, maxZoom: 16 }
      )
    }
  }

  const subtitle = 'Circle' in geofence.Geometry
    ? `Círculo · ${Math.round(geofence.Geometry.Circle.Radius)} m`
    : 'Polígono'

  return (
    <div
      className={`geofence-list-item${isHidden ? ' geofence-list-item--hidden' : ''}`}
      onClick={handleFlyTo}
      style={{ cursor: 'pointer' }}
    >
      <EnvironmentOutlined className="geofence-list-item__icon" />
      <div className="geofence-list-item__info">
        <Typography.Text strong ellipsis style={{ maxWidth: 120 }}>
          {geofence.GeofenceId}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {subtitle}
        </Typography.Text>
      </div>
      <Space size={2}>
        <Button
          size="small" type="text"
          icon={isHidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          onClick={(e) => { e.stopPropagation(); onToggleVisibility(geofence.GeofenceId) }}
        />
        <Button
          size="small" type="text"
          icon={<EditOutlined />}
          onClick={(e) => { e.stopPropagation(); onEdit(geofence) }}
        />
        <Popconfirm
          title="¿Eliminar geocerca?"
          okText="Sí"
          cancelText="No"
          onConfirm={handleDelete}
          onPopupClick={(e) => e.stopPropagation()}
        >
          <Button
            size="small" type="text" danger
            icon={<DeleteOutlined />}
            loading={deleting}
            onClick={(e) => e.stopPropagation()}
          />
        </Popconfirm>
      </Space>
    </div>
  )
}
