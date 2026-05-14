import { useEffect, useState } from 'react'
import { Alert, Button, Modal, Select, Spin, Tooltip, Typography } from 'antd'
import {
  PlusOutlined, DownOutlined, RightOutlined, ApartmentOutlined,
  WarningOutlined, EyeOutlined, EyeInvisibleOutlined,
} from '@ant-design/icons'
import { useGeofencesStore, parseGeofenceId } from '../geofencesStore'
import { useVehiclesStore } from '../../vehicles/vehiclesStore'
import GeofenceListItem from './GeofenceListItem'
import GeofenceFormModal from './GeofenceFormModal'
import type { Geofence } from '../types'
import '../../../styles/geofences.css'

function colorFromTracker(trackerName: string): string {
  const palette = ['#00418b', '#0f766e', '#9a3412', '#6d28d9', '#0369a1', '#be123c']
  let hash = 0
  for (let i = 0; i < trackerName.length; i++) {
    hash = (hash << 5) - hash + trackerName.charCodeAt(i); hash |= 0
  }
  return palette[Math.abs(hash) % palette.length]
}

function MigrateModal({ geofence, trackers, onConfirm, onCancel }: {
  geofence: Geofence; trackers: string[]
  onConfirm: (tn: string) => void; onCancel: () => void
}) {
  const [selected, setSelected] = useState<string>(trackers[0] ?? '')
  return (
    <Modal open title="Asignar geocerca a tracker" onOk={() => selected && onConfirm(selected)}
      onCancel={onCancel} okText="Asignar" okButtonProps={{ disabled: !selected }} width={340}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          <strong>{geofence.GeofenceId}</strong> no tiene tracker asignado.
          Selecciona el tracker al que pertenece.
        </Typography.Text>
        <Select value={selected} onChange={setSelected} style={{ width: '100%' }}>
          {trackers.map(t => <Select.Option key={t} value={t}>{t}</Select.Option>)}
        </Select>
      </div>
    </Modal>
  )
}

export default function GeofencePanel() {
  const geofences                = useGeofencesStore(s => s.geofences)
  const loading                  = useGeofencesStore(s => s.loading)
  const error                    = useGeofencesStore(s => s.error)
  const phase                    = useGeofencesStore(s => s.phase)
  const draft                    = useGeofencesStore(s => s.draft)
  const hiddenGeofences          = useGeofencesStore(s => s.hiddenGeofences)
  const fetchGeofences           = useGeofencesStore(s => s.fetchGeofences)
  const startCreate              = useGeofencesStore(s => s.startCreate)
  const startEdit                = useGeofencesStore(s => s.startEdit)
  const cancelDraft              = useGeofencesStore(s => s.cancelDraft)
  const toggleGeofenceVisibility = useGeofencesStore(s => s.toggleGeofenceVisibility)
  // FIX 1: acción que propaga ocultar/mostrar al store (y por tanto al mapa)
  const toggleTrackerVisibility  = useGeofencesStore(s => s.toggleTrackerVisibility)
  const migrateGeofence          = useGeofencesStore(s => s.migrateGeofence)

  const trackerResources = useVehiclesStore(s => s.trackerResources)
  const trackerNames     = trackerResources.map(t => t.trackerName)

  const [selectedTracker, setSelectedTracker]     = useState<string>('')
  const [drawMode, setDrawMode]                   = useState<'polygon' | 'circle'>('polygon')
  const [collapsedTrackers, setCollapsedTrackers] = useState<Record<string, boolean>>({})
  const [migrateTarget, setMigrateTarget]         = useState<Geofence | null>(null)

  useEffect(() => {
    if (!selectedTracker && trackerNames.length) setSelectedTracker(trackerNames[0])
  }, [trackerNames.join(',')]) // eslint-disable-line

  useEffect(() => {
    fetchGeofences()
    return () => { cancelDraft() }
  }, [fetchGeofences, cancelDraft])

  const isDrawing = phase === 'drawing'
  const modalOpen = phase === 'confirming' || phase === 'editing'

  const { assigned, unassigned } = geofences.reduce<{ assigned: Geofence[]; unassigned: Geofence[] }>(
    (acc, g) => {
      parseGeofenceId(g.GeofenceId).trackerName ? acc.assigned.push(g) : acc.unassigned.push(g)
      return acc
    }, { assigned: [], unassigned: [] }
  )

  const byTracker: Record<string, Geofence[]> = {}
  for (const t of trackerNames) byTracker[t] = []
  for (const g of assigned) {
    const { trackerName } = parseGeofenceId(g.GeofenceId)
    if (!byTracker[trackerName]) byTracker[trackerName] = []
    byTracker[trackerName].push(g)
  }

  // Determina si todas las geocercas de un tracker están ocultas en el store.
  const isTrackerHidden = (tn: string): boolean => {
    const ids = (byTracker[tn] ?? []).map(g => g.GeofenceId)
    return ids.length > 0 && ids.every(id => !!hiddenGeofences[id])
  }

  const handleToggleTracker = (tn: string) => {
    const ids = (byTracker[tn] ?? []).map(g => g.GeofenceId)
    if (!ids.length) return
    // Si ya están todos ocultos → mostrar; si no → ocultar
    toggleTrackerVisibility(ids, !isTrackerHidden(tn))
  }

  return (
    <div className="geofence-panel">

      {/* ── Header ── */}
      <div className="gp-header">
        {!isDrawing ? (
          <>
            {/* Row 1: count + type toggle */}
            <div className="gp-header__row">
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {geofences.length} geocerca{geofences.length !== 1 ? 's' : ''}
              </Typography.Text>
              <div className="gp-type-toggle">
                <button
                  className={`gp-type-btn${drawMode === 'polygon' ? ' gp-type-btn--active' : ''}`}
                  onClick={() => setDrawMode('polygon')}
                >
                  Polígono
                </button>
                <button
                  className={`gp-type-btn${drawMode === 'circle' ? ' gp-type-btn--active' : ''}`}
                  onClick={() => setDrawMode('circle')}
                >
                  Círculo
                </button>
              </div>
            </div>

            {/* Row 2: tracker selector + create */}
            <div className="gp-header__row gp-header__row--create">
              {trackerNames.length > 1 ? (
                <Select
                  size="small"
                  value={selectedTracker || undefined}
                  placeholder="Tracker"
                  onChange={setSelectedTracker}
                  style={{ flex: 1, minWidth: 0 }}
                  optionLabelProp="label"
                >
                  {trackerNames.map(t => (
                    <Select.Option key={t} value={t} label={
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="gp-tracker-dot" style={{ background: colorFromTracker(t) }} />
                        {t}
                      </span>
                    }>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="gp-tracker-dot" style={{ background: colorFromTracker(t) }} />
                        <span>{t}</span>
                        <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                          {(byTracker[t] ?? []).length}
                        </Typography.Text>
                      </span>
                    </Select.Option>
                  ))}
                </Select>
              ) : trackerNames.length === 1 ? (
                <div className="gp-single-tracker">
                  <span className="gp-tracker-dot" style={{ background: colorFromTracker(trackerNames[0]) }} />
                  <Typography.Text style={{ fontSize: 12 }}>{trackerNames[0]}</Typography.Text>
                </div>
              ) : null}
              <Tooltip
                title={!selectedTracker ? 'Selecciona un tracker primero' : undefined}
                mouseEnterDelay={0.3}
              >
                <Button
                  type="primary" size="small" icon={<PlusOutlined />}
                  disabled={!selectedTracker}
                  onClick={() => startCreate(drawMode, selectedTracker)}
                >
                  Nueva
                </Button>
              </Tooltip>
            </div>
          </>
        ) : (
          /* Drawing mode */
          <div className="gp-drawing-state">
            <div className="gp-drawing-state__indicator">
              <span className="gp-drawing-dot" />
              <Typography.Text style={{ fontSize: 12, fontWeight: 500 }}>
                {draft?.mode === 'circle' ? 'Círculo' : 'Polígono'}
                <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 400, marginLeft: 4 }}>
                  — {draft?.mode === 'circle' ? 'Click para centro, arrastra para radio' : 'Click para agregar puntos'}
                </Typography.Text>
              </Typography.Text>
            </div>
            <button className="gp-cancel-btn" onClick={cancelDraft}>
              <kbd>ESC</kbd> Cancelar
            </button>
          </div>
        )}
      </div>

      {error && <Alert type="error" message={error} showIcon style={{ margin: '0 10px 6px' }} />}

      {/* ── List ── */}
      <div className="geofence-panel__list">
        {loading && !geofences.length ? (
          <div className="geofence-panel__loading"><Spin size="small" /></div>
        ) : (
          <>
            {trackerNames.map(tn => {
              const tGeofences  = byTracker[tn] ?? []
              const isCollapsed = !!collapsedTrackers[tn]
              // FIX 1: derivado del store, no de estado local
              const isHiddenT   = isTrackerHidden(tn)
              const color       = colorFromTracker(tn)

              return (
                <div key={tn} className="gp-tracker-group">
                  {/* Tracker header */}
                  <div
                    className="gp-tracker-header"
                    onClick={() => setCollapsedTrackers(p => ({ ...p, [tn]: !p[tn] }))}
                  >
                    <span className="gp-tracker-header__chevron">
                      {isCollapsed ? <RightOutlined /> : <DownOutlined />}
                    </span>
                    <ApartmentOutlined style={{ color, fontSize: 12 }} />
                    <span className="gp-tracker-header__name">{tn}</span>
                    <span className="gp-tracker-header__count">{tGeofences.length}</span>
                    <div className="gp-tracker-header__actions" onClick={e => e.stopPropagation()}>
                      <Tooltip title={isHiddenT ? 'Mostrar en mapa' : 'Ocultar en mapa'} mouseEnterDelay={0.4}>
                        <button
                          className="gp-icon-btn"
                          onClick={() => handleToggleTracker(tn)}
                        >
                          {isHiddenT ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                        </button>
                      </Tooltip>
                    </div>
                  </div>

                  {/* Geofence items */}
                  {!isCollapsed && (
                    <div className="gp-tracker-body">
                      {tGeofences.length === 0 ? (
                        <div className="gp-empty-group">
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            Sin geocercas
                          </Typography.Text>
                        </div>
                      ) : tGeofences.map(g => (
                        <GeofenceListItem
                          key={g.GeofenceId}
                          geofence={g}
                          trackerColor={color}
                          onEdit={startEdit}
                          isHidden={!!hiddenGeofences[g.GeofenceId]}
                          onToggleVisibility={toggleGeofenceVisibility}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Unassigned */}
            {unassigned.length > 0 && (
              <div className="gp-tracker-group gp-tracker-group--warning">
                <div className="gp-tracker-header">
                  <WarningOutlined style={{ color: '#d97706', fontSize: 12 }} />
                  <span className="gp-tracker-header__name" style={{ color: '#d97706' }}>Sin tracker</span>
                  <span className="gp-tracker-header__count">{unassigned.length}</span>
                </div>
                <div className="gp-tracker-body">
                  {unassigned.map(g => (
                    <GeofenceListItem
                      key={g.GeofenceId}
                      geofence={g}
                      trackerColor="#d97706"
                      onEdit={startEdit}
                      isHidden={!!hiddenGeofences[g.GeofenceId]}
                      onToggleVisibility={toggleGeofenceVisibility}
                      onMigrate={() => setMigrateTarget(g)}
                    />
                  ))}
                </div>
              </div>
            )}

            {trackerNames.length === 0 && unassigned.length === 0 && (
              <div className="geofence-panel__empty">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  No hay geocercas
                </Typography.Text>
              </div>
            )}
          </>
        )}
      </div>

      <GeofenceFormModal open={modalOpen} initialId={draft?.geofenceId} onCancel={cancelDraft} />

      {migrateTarget && (
        <MigrateModal
          geofence={migrateTarget}
          trackers={trackerNames}
          onConfirm={async tn => { await migrateGeofence(migrateTarget.GeofenceId, tn); setMigrateTarget(null) }}
          onCancel={() => setMigrateTarget(null)}
        />
      )}
    </div>
  )
}
