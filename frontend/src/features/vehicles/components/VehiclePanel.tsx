import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Input, Spin, Tooltip, Typography } from 'antd'
import {
  CarOutlined,
  ApartmentOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  DownOutlined,
  RightOutlined,
  SortAscendingOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckOutlined,
  CloseOutlined,
  FolderOutlined,
} from '@ant-design/icons'
import { useVehiclesStore } from '../vehiclesStore'
import type { FollowMode } from '../vehiclesStore'
import { useMapStore } from '../../../store/mapStore'
import { getAnimatedPosition } from '../useVehicleLayers'
import type { Device, DeviceGroup } from '../types'

function colorFromTracker(trackerName: string): string {
  const palette = ['#00418b', '#0f766e', '#9a3412', '#6d28d9', '#0369a1', '#be123c']
  let hash = 0
  for (let i = 0; i < trackerName.length; i += 1) {
    hash = (hash << 5) - hash + trackerName.charCodeAt(i)
    hash |= 0
  }
  return palette[Math.abs(hash) % palette.length]
}

// ── SVG icons for follow modes ────────────────────────────────────────────────
const SVG_FOLLOW_OVERVIEW = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
    <path d="M12 2a10 10 0 0 1 0 20A10 10 0 0 1 12 2z" strokeOpacity="0.3"/>
  </svg>
)

const SVG_FOLLOW_NAV = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12,2 22,20 12,16 2,20" fill="currentColor" stroke="none"/>
  </svg>
)

const SVG_FOLLOW_NONE = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
  </svg>
)

// ── InlineEdit ────────────────────────────────────────────────────────────────
function InlineEdit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    setEditing(false)
  }

  if (!editing) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <span style={{ fontSize: 12 }}>{value}</span>
        <EditOutlined
          style={{ fontSize: 10, opacity: 0.35, cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); setDraft(value); setEditing(true) }}
        />
      </span>
    )
  }

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }} onClick={(e) => e.stopPropagation()}>
      <Input
        size="small"
        value={draft}
        autoFocus
        style={{ width: 90, height: 20, fontSize: 11, padding: '0 4px' }}
        onChange={(e) => setDraft(e.target.value)}
        onPressEnter={commit}
        onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
      />
      <CheckOutlined style={{ fontSize: 10, color: '#52c41a', cursor: 'pointer' }} onClick={commit} />
      <CloseOutlined style={{ fontSize: 10, color: '#ff4d4f', cursor: 'pointer' }} onClick={() => setEditing(false)} />
    </span>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function VehiclePanel() {
  const trackerResources        = useVehiclesStore((s) => s.trackerResources)
  const devices                 = useVehiclesStore((s) => s.devices)
  const trackerMeta             = useVehiclesStore((s) => s.trackerMeta)
  const loading                 = useVehiclesStore((s) => s.loading)
  const error                   = useVehiclesStore((s) => s.error)
  const selectedDeviceId        = useVehiclesStore((s) => s.selectedDeviceId)
  const followMode              = useVehiclesStore((s) => s.followMode)
  const followTrackerName       = useVehiclesStore((s) => s.followTrackerName)
  const collapsedTrackers       = useVehiclesStore((s) => s.collapsedTrackers)
  const collapsedGroups         = useVehiclesStore((s) => s.collapsedGroups)
  const hiddenTrackers          = useVehiclesStore((s) => s.hiddenTrackers)
  const hiddenGroups            = useVehiclesStore((s) => s.hiddenGroups)
  const hiddenDevices           = useVehiclesStore((s) => s.hiddenDevices)
  const cancelPlace             = useVehiclesStore((s) => s.cancelPlace)
  const selectDevice            = useVehiclesStore((s) => s.selectDevice)
  const setFollow               = useVehiclesStore((s) => s.setFollow)
  const setFollowMode           = useVehiclesStore((s) => s.setFollowMode)
  const toggleTrackerCollapsed  = useVehiclesStore((s) => s.toggleTrackerCollapsed)
  const toggleGroupCollapsed    = useVehiclesStore((s) => s.toggleGroupCollapsed)
  const toggleTrackerVisibility = useVehiclesStore((s) => s.toggleTrackerVisibility)
  const toggleGroupVisibility   = useVehiclesStore((s) => s.toggleGroupVisibility)
  const toggleDeviceVisibility  = useVehiclesStore((s) => s.toggleDeviceVisibility)
  const createGroup             = useVehiclesStore((s) => s.createGroup)
  const renameGroup             = useVehiclesStore((s) => s.renameGroup)
  const deleteGroup             = useVehiclesStore((s) => s.deleteGroup)
  const assignDeviceToGroup     = useVehiclesStore((s) => s.assignDeviceToGroup)
  const map = useMapStore((s) => s.map)

  const [sortOrder, setSortOrder] = useState<'activity' | 'alpha'>('activity')
  const [newGroupTracker, setNewGroupTracker] = useState<string | null>(null)
  const [newGroupName, setNewGroupName] = useState('')

  useEffect(() => { return () => { cancelPlace() } }, [cancelPlace])

  const flyToDevice = (deviceId: string, trackerName: string) => {
    const animated   = getAnimatedPosition(trackerName, deviceId)
    const storeDevice = devices.find((d) => d.deviceId === deviceId && d.trackerName === trackerName)
    const lat = animated?.lat ?? storeDevice?.lat
    const lng = animated?.lng ?? storeDevice?.lng
    if (lat != null && lng != null && map) {
      map.flyTo({ center: [lng, lat], zoom: 15 })
    }
    selectDevice(deviceId)
  }

  const handleFollowClick = (deviceId: string, trackerName: string) => {
    const isFollowing = selectedDeviceId === deviceId && followTrackerName === trackerName
    if (!isFollowing) {
      setFollow(deviceId, trackerName, 'overview')
      flyToDevice(deviceId, trackerName)
      return
    }
    // Cycle: overview → navigation → none
    if (followMode === 'overview')    { setFollowMode('navigation'); return }
    if (followMode === 'navigation')  { setFollow(null, null, 'none'); return }
    setFollow(deviceId, trackerName, 'overview')
  }

  const devicesByTracker = useMemo(() => {
    const groups: Record<string, typeof devices> = {}
    for (const device of devices) {
      if (!groups[device.trackerName]) groups[device.trackerName] = []
      groups[device.trackerName].push(device)
    }
    return groups
  }, [devices])

  const handleCreateGroup = (trackerName: string) => {
    const name = newGroupName.trim()
    if (!name) return
    createGroup(trackerName, name)
    setNewGroupName('')
    setNewGroupTracker(null)
  }

  return (
    <div className="vehicle-panel">
      {/* ── Toolbar ── */}
      <div className="vehicle-panel__toolbar">
        <div style={{ display: 'flex', gap: 6, width: '100%', alignItems: 'center' }}>
          <Typography.Text type="secondary" style={{ fontSize: 11, flex: 1 }}>
            {devices.length} vehículo{devices.length !== 1 ? 's' : ''}
          </Typography.Text>
          <div className="vehicle-sort-toggle">
            <Tooltip title="Ordenar por actividad" mouseEnterDelay={0.4}>
              <button
                className={`vehicle-sort-btn${sortOrder === 'activity' ? ' vehicle-sort-btn--active' : ''}`}
                onClick={() => setSortOrder('activity')}
              >
                <ClockCircleOutlined />
              </button>
            </Tooltip>
            <Tooltip title="Ordenar alfabéticamente" mouseEnterDelay={0.4}>
              <button
                className={`vehicle-sort-btn${sortOrder === 'alpha' ? ' vehicle-sort-btn--active' : ''}`}
                onClick={() => setSortOrder('alpha')}
              >
                <SortAscendingOutlined />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {error && <Alert type="error" message={error} showIcon style={{ margin: '8px 12px' }} />}

      {/* ── List ── */}
      <div className="vehicle-panel__list">
        {loading && !devices.length ? (
          <div className="vehicle-panel__loading"><Spin size="small" /></div>
        ) : trackerResources.length === 0 ? (
          <Typography.Text type="secondary" className="vehicle-panel__empty">
            No hay flotas disponibles
          </Typography.Text>
        ) : (
          trackerResources.map((tracker) => {
            const trackerName     = tracker.trackerName
            const meta            = trackerMeta[trackerName]
            const groups          = meta?.groups ?? []
            const deviceGroups    = meta?.deviceGroups ?? {}
            const trackerDevices  = devicesByTracker[trackerName] ?? []
            const isCollapsed     = !!collapsedTrackers[trackerName]
            const isTrackerHidden = !!hiddenTrackers[trackerName]
            const trackerColor    = colorFromTracker(trackerName)

            const sortedDevices = [...trackerDevices].sort((a, b) =>
              sortOrder === 'alpha'
                ? a.deviceId.localeCompare(b.deviceId)
                : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            )

            const ungroupedDevices = sortedDevices.filter((d) => !deviceGroups[d.deviceId])

            return (
              <div key={trackerName} className="tracker-group">
                {/* Tracker header */}
                <div className="tracker-group__header">
                  <div className="tracker-group__left" onClick={() => toggleTrackerCollapsed(trackerName)}>
                    {isCollapsed
                      ? <RightOutlined className="tracker-group__chevron" />
                      : <DownOutlined  className="tracker-group__chevron" />
                    }
                    <ApartmentOutlined style={{ color: trackerColor, fontSize: 13 }} />
                    <div className="vehicle-item__info">
                      <Typography.Text strong ellipsis style={{ maxWidth: 120, fontSize: 13 }}>
                        {trackerName}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {trackerDevices.length} dispositivo{trackerDevices.length !== 1 ? 's' : ''}
                      </Typography.Text>
                    </div>
                  </div>
                  <div className="tracker-group__actions">
                    <Tooltip title="Nuevo grupo" mouseEnterDelay={0.4}>
                      <Button
                        size="small" type="text"
                        icon={<PlusOutlined />}
                        style={{ width: 24, height: 24 }}
                        onClick={() => setNewGroupTracker(newGroupTracker === trackerName ? null : trackerName)}
                      />
                    </Tooltip>
                    <Button
                      size="small" type="text"
                      icon={isTrackerHidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                      style={{ width: 24, height: 24 }}
                      onClick={() => toggleTrackerVisibility(trackerName)}
                    />
                  </div>
                </div>

                {/* New group input */}
                {newGroupTracker === trackerName && (
                  <div style={{ display: 'flex', gap: 4, padding: '4px 10px 4px 32px' }}>
                    <Input
                      size="small"
                      placeholder="Nombre del grupo"
                      value={newGroupName}
                      autoFocus
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onPressEnter={() => handleCreateGroup(trackerName)}
                      onKeyDown={(e) => e.key === 'Escape' && setNewGroupTracker(null)}
                      style={{ fontSize: 12 }}
                    />
                    <Button size="small" type="primary" onClick={() => handleCreateGroup(trackerName)}>
                      Crear
                    </Button>
                    <Button size="small" onClick={() => { setNewGroupTracker(null); setNewGroupName('') }}>
                      <CloseOutlined />
                    </Button>
                  </div>
                )}

                {!isCollapsed && (
                  <div className="tracker-group__devices">
                    {/* ── Groups ── */}
                    {groups.map((group) => {
                      const groupKey     = `${trackerName}/${group.id}`
                      const isGCollapsed = !!collapsedGroups[groupKey]
                      const isGHidden    = !!hiddenGroups[groupKey]
                      const groupDevices = sortedDevices.filter((d) => deviceGroups[d.deviceId] === group.id)

                      return (
                        <div key={group.id} className="device-group">
                          <div className="device-group__header">
                            <div className="device-group__left" onClick={() => toggleGroupCollapsed(trackerName, group.id)}>
                              {isGCollapsed
                                ? <RightOutlined style={{ fontSize: 9 }} />
                                : <DownOutlined  style={{ fontSize: 9 }} />
                              }
                              <FolderOutlined style={{ color: trackerColor, fontSize: 11, opacity: 0.75 }} />
                              <InlineEdit
                                value={group.name}
                                onSave={(v) => renameGroup(trackerName, group.id, v)}
                              />
                              <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                                ({groupDevices.length})
                              </Typography.Text>
                            </div>
                            <div style={{ display: 'flex', gap: 1 }}>
                              <Button
                                size="small" type="text"
                                icon={isGHidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                                style={{ width: 22, height: 22 }}
                                onClick={() => toggleGroupVisibility(trackerName, group.id)}
                              />
                              <Tooltip title="Eliminar grupo" mouseEnterDelay={0.4}>
                                <Button
                                  size="small" type="text" danger
                                  icon={<DeleteOutlined />}
                                  style={{ width: 22, height: 22 }}
                                  onClick={() => deleteGroup(trackerName, group.id)}
                                />
                              </Tooltip>
                            </div>
                          </div>

                          {!isGCollapsed && (
                            <div className="device-group__devices">
                              {groupDevices.length === 0 ? (
                                <Typography.Text type="secondary" style={{ fontSize: 11, padding: '4px 8px', display: 'block' }}>
                                  Sin vehículos
                                </Typography.Text>
                              ) : (
                                groupDevices.map((d) => (
                                  <DeviceItem
                                    key={`${d.trackerName}/${d.deviceId}`}
                                    d={d}
                                    trackerColor={trackerColor}
                                    isTrackerHidden={isTrackerHidden}
                                    isGroupHidden={isGHidden}
                                    isSelected={d.deviceId === selectedDeviceId && d.trackerName === followTrackerName}
                                    followMode={d.deviceId === selectedDeviceId && d.trackerName === followTrackerName ? followMode : 'none'}
                                    isHidden={!!hiddenDevices[`${d.trackerName}/${d.deviceId}`]}
                                    groups={groups}
                                    currentGroupId={group.id}
                                    onFlyTo={flyToDevice}
                                    onFollow={handleFollowClick}
                                    onToggleVisibility={toggleDeviceVisibility}
                                    onAssignGroup={assignDeviceToGroup}
                                  />
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* ── Ungrouped ── */}
                    {ungroupedDevices.length > 0 && (
                      <div className="device-group__ungrouped">
                        {groups.length > 0 && (
                          <div className="device-group__ungrouped-label">
                            <Typography.Text type="secondary" style={{ fontSize: 10 }}>Sin grupo</Typography.Text>
                          </div>
                        )}
                        {ungroupedDevices.map((d) => (
                          <DeviceItem
                            key={`${d.trackerName}/${d.deviceId}`}
                            d={d}
                            trackerColor={trackerColor}
                            isTrackerHidden={isTrackerHidden}
                            isGroupHidden={false}
                            isSelected={d.deviceId === selectedDeviceId && d.trackerName === followTrackerName}
                            followMode={d.deviceId === selectedDeviceId && d.trackerName === followTrackerName ? followMode : 'none'}
                            isHidden={!!hiddenDevices[`${d.trackerName}/${d.deviceId}`]}
                            groups={groups}
                            currentGroupId={null}
                            onFlyTo={flyToDevice}
                            onFollow={handleFollowClick}
                            onToggleVisibility={toggleDeviceVisibility}
                            onAssignGroup={assignDeviceToGroup}
                          />
                        ))}
                      </div>
                    )}

                    {trackerDevices.length === 0 && (
                      <Typography.Text type="secondary" className="tracker-group__empty">
                        Sin dispositivos
                      </Typography.Text>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── DeviceItem ────────────────────────────────────────────────────────────────
interface DeviceItemProps {
  d: Device
  trackerColor: string
  isTrackerHidden: boolean
  isGroupHidden: boolean
  isSelected: boolean
  followMode: FollowMode
  isHidden: boolean
  groups: DeviceGroup[]
  currentGroupId: string | null
  onFlyTo: (deviceId: string, trackerName: string) => void
  onFollow: (deviceId: string, trackerName: string) => void
  onToggleVisibility: (trackerName: string, deviceId: string) => void
  onAssignGroup: (trackerName: string, deviceId: string, groupId: string | null) => void
}

function DeviceItem({
  d, trackerColor, isTrackerHidden, isGroupHidden,
  isSelected, followMode, isHidden,
  groups, currentGroupId,
  onFlyTo, onFollow, onToggleVisibility, onAssignGroup,
}: DeviceItemProps) {
  const minutesAgo = Math.floor((Date.now() - new Date(d.updatedAt).getTime()) / 60_000)
  const isActive   = minutesAgo < 5

  const followIcon = followMode === 'navigation' ? SVG_FOLLOW_NAV
    : followMode === 'overview' ? SVG_FOLLOW_OVERVIEW
    : SVG_FOLLOW_NONE

  const followTitle = followMode === 'none' ? 'Seguir vehículo'
    : followMode === 'overview' ? 'Cambiar a vista de conducción'
    : 'Detener seguimiento'

  return (
    <div
      className={[
        'vehicle-item',
        isSelected ? 'vehicle-item--selected' : '',
        isHidden || isTrackerHidden || isGroupHidden ? 'vehicle-item--hidden' : '',
        isSelected && followMode !== 'none' ? 'vehicle-item--following' : '',
      ].filter(Boolean).join(' ')}
      style={isSelected && followMode !== 'none' ? { borderLeft: `3px solid ${trackerColor}` } : undefined}
      onClick={() => onFlyTo(d.deviceId, d.trackerName)}
    >
      <div className="vehicle-item__tracker-strip" style={{ backgroundColor: trackerColor }} />
      <CarOutlined className="vehicle-item__icon" />
      <div className="vehicle-item__info">
        <Typography.Text strong ellipsis style={{ maxWidth: 85, fontSize: 12 }}>
          {d.deviceId}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {d.speed != null ? `${Math.round(d.speed)} km/h · ` : ''}
          {minutesAgo === 0 ? 'ahora' : `hace ${minutesAgo} min`}
        </Typography.Text>
      </div>

      {/* Group assign */}
      {groups.length > 0 && (
        <Tooltip
          title={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 11, opacity: 0.6, marginBottom: 2 }}>Asignar grupo</span>
              {groups.map((g) => (
                <div
                  key={g.id}
                  style={{
                    cursor: 'pointer', padding: '2px 6px', borderRadius: 4, fontSize: 12,
                    background: g.id === currentGroupId ? 'rgba(255,255,255,0.15)' : 'transparent',
                  }}
                  onClick={(e) => { e.stopPropagation(); onAssignGroup(d.trackerName, d.deviceId, g.id) }}
                >
                  {g.id === currentGroupId ? '✓ ' : ''}{g.name}
                </div>
              ))}
              {currentGroupId && (
                <div
                  style={{ cursor: 'pointer', padding: '2px 6px', fontSize: 11, opacity: 0.5 }}
                  onClick={(e) => { e.stopPropagation(); onAssignGroup(d.trackerName, d.deviceId, null) }}
                >
                  Quitar del grupo
                </div>
              )}
            </div>
          }
          trigger="click"
          mouseEnterDelay={99}
        >
          <Button
            size="small" type="text"
            icon={<FolderOutlined />}
            style={{ width: 22, height: 22, opacity: currentGroupId ? 0.7 : 0.35 }}
            onClick={(e) => e.stopPropagation()}
          />
        </Tooltip>
      )}

      {/* Follow */}
      <Tooltip title={followTitle} mouseEnterDelay={0.4}>
        <Button
          size="small" type="text"
          style={{
            width: 22, height: 22,
            color: followMode !== 'none' ? trackerColor : undefined,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={(e) => { e.stopPropagation(); onFollow(d.deviceId, d.trackerName) }}
        >
          {followIcon}
        </Button>
      </Tooltip>

      {/* Visibility */}
      <Button
        size="small" type="text"
        icon={isHidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
        style={{ width: 22, height: 22 }}
        onClick={(e) => { e.stopPropagation(); onToggleVisibility(d.trackerName, d.deviceId) }}
      />

      <span className={`vehicle-status-dot${isActive ? ' vehicle-status-dot--active' : ''}`} />
    </div>
  )
}
