import { useState } from 'react'
import { Button, Popconfirm, Tooltip, Typography } from 'antd'
import { EditOutlined, DeleteOutlined, EyeOutlined, EyeInvisibleOutlined, SwapOutlined } from '@ant-design/icons'
import type { Geofence } from '../types'
import { useGeofencesStore, parseGeofenceId } from '../geofencesStore'
import { useMapStore } from '../../../store/mapStore'
import * as turf from '@turf/turf'

interface Props {
  geofence: Geofence
  trackerColor: string
  onEdit: (geofence: Geofence) => void
  isHidden: boolean
  onToggleVisibility: (geofenceId: string) => void
  onMigrate?: () => void
}

function getGeofenceCenter(geofence: Geofence): [number, number] | null {
  if ('Circle' in geofence.Geometry) return geofence.Geometry.Circle.Center
  if ('Polygon' in geofence.Geometry) {
    const coords = geofence.Geometry.Polygon[0]
    if (!coords?.length) return null
    return turf.centroid(turf.polygon(geofence.Geometry.Polygon)).geometry.coordinates as [number, number]
  }
  return null
}

// Shape icon SVGs
const IconPolygon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/>
  </svg>
)

const IconCircle = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="10"/>
    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" opacity="0.4"/>
  </svg>
)

export default function GeofenceListItem({ geofence, trackerColor, onEdit, isHidden, onToggleVisibility, onMigrate }: Props) {
  const deleteGeofence = useGeofencesStore(s => s.deleteGeofence)
  const map            = useMapStore(s => s.map)
  const [deleting, setDeleting] = useState(false)

  const { name: displayName } = parseGeofenceId(geofence.GeofenceId)
  const isCircle = 'Circle' in geofence.Geometry

  const subtitle = isCircle
    ? `${Math.round(geofence.Geometry.Circle.Radius)} m radio`
    : 'Polígono'

  const handleFlyTo = () => {
    if (!map) return
    const center = getGeofenceCenter(geofence)
    if (!center) return
    if (isCircle) {
      const radiusKm = geofence.Geometry.Circle.Radius / 1000
      map.flyTo({ center, zoom: Math.max(10, Math.min(16, 14 - Math.log2(radiusKm))) })
    } else {
      const coords = geofence.Geometry.Polygon[0]
      const lngs = coords.map(c => c[0])
      const lats = coords.map(c => c[1])
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, maxZoom: 16 })
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    await deleteGeofence(geofence.GeofenceId)
    setDeleting(false)
  }

  return (
    <div
      className={`gp-fence-item${isHidden ? ' gp-fence-item--hidden' : ''}`}
      style={{ borderLeftColor: trackerColor }}
      onClick={handleFlyTo}
    >
      {/* Shape icon */}
      <span className="gp-fence-item__shape" style={{ color: trackerColor }}>
        {isCircle ? <IconCircle /> : <IconPolygon />}
      </span>

      {/* Info */}
      <div className="gp-fence-item__info">
        <Typography.Text strong ellipsis style={{ fontSize: 12, maxWidth: 110, display: 'block' }}>
          {displayName}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 10 }}>
          {subtitle}
        </Typography.Text>
      </div>

      {/* Actions — visible on hover via CSS */}
      <div className="gp-fence-item__actions" onClick={e => e.stopPropagation()}>
        {onMigrate && (
          <Tooltip title="Asignar a tracker" mouseEnterDelay={0.3}>
            <button className="gp-icon-btn" onClick={onMigrate}>
              <SwapOutlined style={{ fontSize: 12 }} />
            </button>
          </Tooltip>
        )}
        <Tooltip title={isHidden ? 'Mostrar' : 'Ocultar'} mouseEnterDelay={0.3}>
          <button className="gp-icon-btn" onClick={() => onToggleVisibility(geofence.GeofenceId)}>
            {isHidden ? <EyeInvisibleOutlined style={{ fontSize: 12 }} /> : <EyeOutlined style={{ fontSize: 12 }} />}
          </button>
        </Tooltip>
        <Tooltip title="Editar forma" mouseEnterDelay={0.3}>
          <button className="gp-icon-btn" onClick={() => onEdit(geofence)}>
            <EditOutlined style={{ fontSize: 12 }} />
          </button>
        </Tooltip>
        <Popconfirm
          title="¿Eliminar geocerca?"
          okText="Eliminar" okButtonProps={{ danger: true }}
          cancelText="Cancelar"
          onConfirm={handleDelete}
          onPopupClick={e => e.stopPropagation()}
          placement="left"
        >
          <button className="gp-icon-btn gp-icon-btn--danger" onClick={e => e.stopPropagation()}>
            {deleting
              ? <span style={{ fontSize: 10 }}>...</span>
              : <DeleteOutlined style={{ fontSize: 12 }} />
            }
          </button>
        </Popconfirm>
      </div>
    </div>
  )
}
