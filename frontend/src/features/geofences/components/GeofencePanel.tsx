import { useEffect } from 'react'
import { Alert, Button, Divider, Segmented, Spin, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useGeofencesStore } from '../geofencesStore'
import GeofenceListItem from './GeofenceListItem'
import GeofenceFormModal from './GeofenceFormModal'
import type { Geofence } from '../types'
import '../../../styles/geofences.css'

export default function GeofencePanel() {
  const geofences = useGeofencesStore((s) => s.geofences)
  const loading = useGeofencesStore((s) => s.loading)
  const error = useGeofencesStore((s) => s.error)
  const phase = useGeofencesStore((s) => s.phase)
  const draft = useGeofencesStore((s) => s.draft)
  const hiddenGeofences = useGeofencesStore((s) => s.hiddenGeofences)
  const fetchGeofences = useGeofencesStore((s) => s.fetchGeofences)
  const startCreate = useGeofencesStore((s) => s.startCreate)
  const startEdit = useGeofencesStore((s) => s.startEdit)
  const cancelDraft = useGeofencesStore((s) => s.cancelDraft)
  const toggleGeofenceVisibility = useGeofencesStore((s) => s.toggleGeofenceVisibility)

  useEffect(() => {
    fetchGeofences()
    return () => { cancelDraft() }
  }, [fetchGeofences, cancelDraft])

  const isDrawing = phase === 'drawing'
  const isConfirming = phase === 'confirming'
  const isEditing = phase === 'editing'
  const modalOpen = isConfirming || isEditing

  return (
    <div className="geofence-panel">
      {/* Toolbar */}
      <div className="geofence-panel__toolbar">
        {!isDrawing ? (
          <>
            <Segmented
              size="small"
              options={[
                { label: 'Polígono', value: 'polygon' },
                { label: 'Círculo', value: 'circle' },
              ]}
              defaultValue="polygon"
              onChange={(v) => startCreate(v as 'polygon' | 'circle')}
            />
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => startCreate(draft?.mode ?? 'polygon')}
            >
              Nueva
            </Button>
          </>
        ) : (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {draft?.mode === 'circle' ? 'Haz click para centro y radio' : 'Dibuja el polígono en el mapa'}
            </Typography.Text>
            <Button size="small" onClick={cancelDraft}>Cancelar</Button>
          </>
        )}
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {/* Error */}
      {error && <Alert type="error" message={error} showIcon style={{ margin: '0 12px 8px' }} />}

      {/* List */}
      <div className="geofence-panel__list">
        {loading && !geofences.length ? (
          <div className="geofence-panel__loading">
            <Spin size="small" />
          </div>
        ) : geofences.length === 0 ? (
          <Typography.Text type="secondary" className="geofence-panel__empty">
            No hay geocercas
          </Typography.Text>
        ) : (
          geofences.map((g) => (
            <GeofenceListItem
              key={g.GeofenceId}
              geofence={g}
              onEdit={(gf: Geofence) => startEdit(gf)}
              isHidden={!!hiddenGeofences[g.GeofenceId]}
              onToggleVisibility={toggleGeofenceVisibility}
            />
          ))
        )}
      </div>

      {/* Create / Edit modal */}
      <GeofenceFormModal
        open={modalOpen}
        initialId={draft?.geofenceId}
        onCancel={cancelDraft}
      />
    </div>
  )
}
