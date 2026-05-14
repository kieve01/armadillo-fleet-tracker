import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal, Spin, Tooltip, Typography } from 'antd'
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
  HolderOutlined,
} from '@ant-design/icons'
import { useVehiclesStore } from '../vehiclesStore'
import type { FollowMode } from '../vehiclesStore'
import { useMapStore } from '../../../store/mapStore'
import { getAnimatedPosition } from '../useVehicleLayers'
import type { Device, DeviceGroup } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function colorFromTracker(trackerName: string): string {
  const palette = ['#00418b', '#0f766e', '#9a3412', '#6d28d9', '#0369a1', '#be123c']
  let hash = 0
  for (let i = 0; i < trackerName.length; i++) {
    hash = (hash << 5) - hash + trackerName.charCodeAt(i); hash |= 0
  }
  return palette[Math.abs(hash) % palette.length]
}

function timeLabel(updatedAt: string): { text: string; offline: boolean } {
  const mins = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60_000)
  if (mins < 1)   return { text: 'ahora',      offline: false }
  if (mins === 1) return { text: '1 min',       offline: false }
  if (mins < 60)  return { text: `${mins} min`, offline: false }
  if (mins < 120) return { text: '1 h',         offline: false }
  const hrs = Math.round(mins / 60)
  if (hrs < 24)   return { text: `${hrs} h`,    offline: false }
  return            { text: 'Sin señal',         offline: true  }
}

// ── InlineEdit — cierra al hacer blur ────────────────────────────────────────
function InlineEdit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  const inputRef = useRef<any>(null)

  const commit = () => {
    const t = draft.trim()
    if (t && t !== value) onSave(t)
    setEditing(false)
  }

  if (!editing) return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <span style={{ fontSize: 12 }}>{value}</span>
      <EditOutlined
        style={{ fontSize: 10, opacity: 0.35, cursor: 'pointer' }}
        onClick={e => { e.stopPropagation(); setDraft(value); setEditing(true) }}
      />
    </span>
  )

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }} onClick={e => e.stopPropagation()}>
      <Input
        ref={inputRef}
        size="small" value={draft} autoFocus
        style={{ width: 90, height: 20, fontSize: 11, padding: '0 4px' }}
        onChange={e => setDraft(e.target.value)}
        onPressEnter={commit}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Escape') { setEditing(false) } }}
      />
      <CheckOutlined style={{ fontSize: 10, color: '#52c41a', cursor: 'pointer' }} onMouseDown={e => { e.preventDefault(); commit() }} />
      <CloseOutlined style={{ fontSize: 10, color: '#ff4d4f', cursor: 'pointer' }} onMouseDown={e => { e.preventDefault(); setEditing(false) }} />
    </span>
  )
}

// ── Sort ──────────────────────────────────────────────────────────────────────
type SortOrder = 'activity' | 'alpha' | 'manual'

// useManualOrder: persists via DynamoDB (trackerMeta.deviceOrder)
function useManualOrder(trackerName: string, deviceIds: string[], savedOrder: string[], onSave: (o: string[]) => void) {
  const [order, setOrder] = useState<string[]>(() => {
    const set = new Set(savedOrder)
    return [...savedOrder.filter((id: string) => deviceIds.includes(id)), ...deviceIds.filter((id: string) => !set.has(id))]
  })
  useEffect(() => {
    const set = new Set(savedOrder)
    const merged = [...savedOrder.filter((id: string) => deviceIds.includes(id)), ...deviceIds.filter((id: string) => !set.has(id))]
    setOrder(merged)
  }, [savedOrder.join(','), deviceIds.join(',')]) // eslint-disable-line
  const saveOrder = (o: string[]) => { setOrder(o); onSave(o) }
  return { order, saveOrder }
}

// ── SortBar — reutilizable por grupo ─────────────────────────────────────────
function SortBar({ sortOrder, onSet }: { sortOrder: SortOrder; onSet: (v: SortOrder) => void }) {
  return (
    <div className="vehicle-sort-bar">
      <Tooltip title="Recientes primero" mouseEnterDelay={0.4}>
        <button className={`vehicle-sort-btn${sortOrder === 'activity' ? ' vehicle-sort-btn--active' : ''}`} onClick={() => onSet('activity')}><ClockCircleOutlined /></button>
      </Tooltip>
      <Tooltip title="Alfabético" mouseEnterDelay={0.4}>
        <button className={`vehicle-sort-btn${sortOrder === 'alpha' ? ' vehicle-sort-btn--active' : ''}`} onClick={() => onSet('alpha')}><SortAscendingOutlined /></button>
      </Tooltip>
      <Tooltip title="Orden personalizado" mouseEnterDelay={0.4}>
        <button className={`vehicle-sort-btn${sortOrder === 'manual' ? ' vehicle-sort-btn--active' : ''}`} onClick={() => onSet('manual')}><HolderOutlined /></button>
      </Tooltip>
    </div>
  )
}

// ── Group modal (crear y editar) ──────────────────────────────────────────────
interface GroupModalProps {
  open: boolean
  trackerName: string
  // create mode: no groupId / editGroupId
  editGroupId?: string
  initialName?: string
  initialSelected?: string[]
  devices: Device[]
  deviceGroups: Record<string, string>   // deviceId → groupId (current state)
  groups: DeviceGroup[]                  // all groups for this tracker
  onConfirm: (name: string, deviceIds: string[]) => void
  onCancel: () => void
}

function GroupModal({
  open, trackerName, editGroupId, initialName = '', initialSelected = [],
  devices, deviceGroups, groups, onConfirm, onCancel,
}: GroupModalProps) {
  const [name, setName]         = useState(initialName)
  const [selected, setSelected] = useState<string[]>(initialSelected)

  useEffect(() => {
    if (open) { setName(initialName); setSelected(initialSelected) }
  }, [open]) // eslint-disable-line

  const toggle = (id: string) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const isEdit = !!editGroupId
  const title  = isEdit ? 'Editar grupo' : 'Nuevo grupo'
  const okText = isEdit ? 'Guardar cambios' : 'Crear grupo'

  return (
    <Modal
      open={open} title={title} onCancel={onCancel}
      onOk={() => { const n = name.trim(); if (n) onConfirm(n, selected) }}
      okText={okText} okButtonProps={{ disabled: !name.trim() }}
      width={340} styles={{ body: { padding: '12px 0 0' } }}
    >
      <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input
          placeholder="Nombre del grupo" value={name} autoFocus
          onChange={e => setName(e.target.value)}
          onPressEnter={() => { const n = name.trim(); if (n) onConfirm(n, selected) }}
        />
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
            {isEdit ? 'Vehículos en este grupo' : 'Selecciona los vehículos para este grupo'}
          </Typography.Text>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflowY: 'auto' }}>
            {devices.map(d => {
              const { text, offline } = timeLabel(d.updatedAt)
              const assignedTo = deviceGroups[d.deviceId]
              // In edit mode: can select freely (including from other groups)
              // In create mode: block devices already in a group
              const inOtherGroup = !isEdit && !!assignedTo
              const otherGroupName = assignedTo && assignedTo !== editGroupId
                ? groups.find(g => g.id === assignedTo)?.name
                : null

              const isChecked = selected.includes(d.deviceId)

              return (
                <div
                  key={d.deviceId}
                  onClick={() => !inOtherGroup && toggle(d.deviceId)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px', borderRadius: 6,
                    cursor: inOtherGroup ? 'not-allowed' : 'pointer',
                    opacity: inOtherGroup ? 0.45 : 1,
                    background: isChecked ? 'rgba(0,65,139,0.08)' : 'transparent',
                    transition: 'background 0.13s',
                  }}
                >
                  <Checkbox checked={isChecked} disabled={inOtherGroup} />
                  <CarOutlined style={{ fontSize: 13, color: colorFromTracker(trackerName), flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Typography.Text strong style={{ fontSize: 12, display: 'block' }} ellipsis>{d.deviceId}</Typography.Text>
                    {otherGroupName && (
                      <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                        Actualmente en: {otherGroupName}
                      </Typography.Text>
                    )}
                    {inOtherGroup && !otherGroupName && (
                      <Typography.Text type="secondary" style={{ fontSize: 10 }}>Ya en otro grupo</Typography.Text>
                    )}
                  </div>
                  <Typography.Text style={{ fontSize: 10, flexShrink: 0, color: offline ? '#ef4444' : 'rgba(128,128,128,0.6)' }}>
                    {text}
                  </Typography.Text>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── DraggableDeviceList ───────────────────────────────────────────────────────
interface DraggableListProps {
  devices: Device[]
  order: string[]
  onReorder: (o: string[]) => void
  renderDevice: (d: Device) => React.ReactNode
}

function DraggableDeviceList({ devices, order, onReorder, renderDevice }: DraggableListProps) {
  const dragIdx = useRef<number | null>(null)
  const sorted  = useMemo(() => {
    const map = new Map(devices.map(d => [d.deviceId, d]))
    return order.map(id => map.get(id)).filter(Boolean) as Device[]
  }, [devices, order])

  return (
    <>
      {sorted.map((d, i) => (
        <div
          key={d.deviceId} draggable
          onDragStart={() => { dragIdx.current = i }}
          onDragOver={e => e.preventDefault()}
          onDrop={() => {
            if (dragIdx.current === null || dragIdx.current === i) return
            const next = [...order]; const [m] = next.splice(dragIdx.current, 1); next.splice(i, 0, m)
            onReorder(next); dragIdx.current = null
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 2 }}
        >
          <HolderOutlined style={{ fontSize: 11, color: 'rgba(128,128,128,0.35)', cursor: 'grab', flexShrink: 0, padding: '0 2px' }} />
          <div style={{ flex: 1 }}>{renderDevice(d)}</div>
        </div>
      ))}
    </>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function VehiclePanel() {
  const trackerResources        = useVehiclesStore(s => s.trackerResources)
  const devices                 = useVehiclesStore(s => s.devices)
  const trackerMeta             = useVehiclesStore(s => s.trackerMeta)
  const loading                 = useVehiclesStore(s => s.loading)
  const error                   = useVehiclesStore(s => s.error)
  const selectedDeviceId        = useVehiclesStore(s => s.selectedDeviceId)
  const followMode              = useVehiclesStore(s => s.followMode)
  const followTrackerName       = useVehiclesStore(s => s.followTrackerName)
  const collapsedTrackers       = useVehiclesStore(s => s.collapsedTrackers)
  const collapsedGroups         = useVehiclesStore(s => s.collapsedGroups)
  const hiddenTrackers          = useVehiclesStore(s => s.hiddenTrackers)
  const hiddenGroups            = useVehiclesStore(s => s.hiddenGroups)
  const hiddenDevices           = useVehiclesStore(s => s.hiddenDevices)
  const cancelPlace             = useVehiclesStore(s => s.cancelPlace)
  const setFollow               = useVehiclesStore(s => s.setFollow)
  const setFollowMode           = useVehiclesStore(s => s.setFollowMode)
  const toggleTrackerCollapsed  = useVehiclesStore(s => s.toggleTrackerCollapsed)
  const toggleGroupCollapsed    = useVehiclesStore(s => s.toggleGroupCollapsed)
  const toggleTrackerVisibility = useVehiclesStore(s => s.toggleTrackerVisibility)
  const toggleGroupVisibility   = useVehiclesStore(s => s.toggleGroupVisibility)
  const toggleDeviceVisibility  = useVehiclesStore(s => s.toggleDeviceVisibility)
  const createGroup             = useVehiclesStore(s => s.createGroup)
  const setDeviceOrder          = useVehiclesStore(s => s.setDeviceOrder)
  const renameGroup             = useVehiclesStore(s => s.renameGroup)
  const deleteGroup             = useVehiclesStore(s => s.deleteGroup)
  const assignDeviceToGroup     = useVehiclesStore(s => s.assignDeviceToGroup)
  const map                     = useMapStore(s => s.map)

  const [groupModal, setGroupModal] = useState<{
    trackerName: string
    editGroupId?: string
    initialName?: string
    initialSelected?: string[]
  } | null>(null)

  useEffect(() => { return () => { cancelPlace() } }, [cancelPlace])

  // Click vehículo: toggle selección
  // - si no está seleccionado → selecciona + overview
  // - si ya está seleccionado → deselecciona + none
  const handleSelectDevice = (deviceId: string, trackerName: string) => {
    const isAlreadySelected = selectedDeviceId === deviceId && followTrackerName === trackerName
    if (isAlreadySelected) {
      setFollow(null, null, 'none')
      return
    }
    const animated    = getAnimatedPosition(trackerName, deviceId)
    const storeDevice = devices.find(d => d.deviceId === deviceId && d.trackerName === trackerName)
    const lat = animated?.lat ?? storeDevice?.lat
    const lng = animated?.lng ?? storeDevice?.lng
    setFollow(deviceId, trackerName, 'overview')
    if (lat != null && lng != null && map) {
      map.easeTo({ center: [lng, lat], zoom: 16, bearing: 0, pitch: 0, duration: 800 })
    }
  }

  // Activar modo conducción (solo desde overview)
  const handleNavMode = () => {
    setFollowMode('navigation')
  }

  // Quitar modo conducción → vuelve a overview (no pierde selección)
  const handleExitNav = () => {
    setFollowMode('overview')
  }

  const devicesByTracker = useMemo(() => {
    const g: Record<string, Device[]> = {}
    for (const d of devices) { if (!g[d.trackerName]) g[d.trackerName] = []; g[d.trackerName].push(d) }
    return g
  }, [devices])

  const handleGroupConfirm = (trackerName: string, name: string, deviceIds: string[], editGroupId?: string) => {
    if (editGroupId) {
      // Edit: rename + reconcile membership
      renameGroup(trackerName, editGroupId, name)
      const meta = useVehiclesStore.getState().trackerMeta[trackerName]
      const currentMembers = Object.entries(meta?.deviceGroups ?? {})
        .filter(([, gid]) => gid === editGroupId).map(([did]) => did)
      currentMembers.filter(id => !deviceIds.includes(id))
        .forEach(id => assignDeviceToGroup(trackerName, id, null))
      deviceIds.forEach(id => assignDeviceToGroup(trackerName, id, editGroupId))
    } else {
      // createGroup returns the new group ID synchronously
      const newGroupId = createGroup(trackerName, name)
      deviceIds.forEach(id => assignDeviceToGroup(trackerName, id, newGroupId))
    }
    setGroupModal(null)
  }

  return (
    <div className="vehicle-panel">
      <div className="vehicle-panel__toolbar">
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {devices.length} vehículo{devices.length !== 1 ? 's' : ''}
        </Typography.Text>
      </div>

      {error && <Alert type="error" message={error} showIcon style={{ margin: '0 10px 6px' }} />}

      <div className="vehicle-panel__list">
        {loading && !devices.length ? (
          <div className="vehicle-panel__loading"><Spin size="small" /></div>
        ) : trackerResources.length === 0 ? (
          <Typography.Text type="secondary" className="vehicle-panel__empty">No hay flotas disponibles</Typography.Text>
        ) : (
          trackerResources.map(tracker => {
            const tn = tracker.trackerName
            const meta         = trackerMeta[tn]
            const groups       = meta?.groups ?? []
            const deviceGroups = meta?.deviceGroups ?? {}
            const tDevices     = devicesByTracker[tn] ?? []
            return (
              <TrackerSection key={tn}
                trackerName={tn} trackerColor={colorFromTracker(tn)}
                trackerDevices={tDevices} groups={groups} deviceGroups={deviceGroups}
                isCollapsed={!!collapsedTrackers[tn]} isHiddenT={!!hiddenTrackers[tn]}
                trackerMeta={trackerMeta} setDeviceOrder={setDeviceOrder}
                collapsedGroups={collapsedGroups} hiddenGroups={hiddenGroups} hiddenDevices={hiddenDevices}
                selectedDeviceId={selectedDeviceId} followMode={followMode} followTrackerName={followTrackerName}
                onToggleCollapse={() => toggleTrackerCollapsed(tn)}
                onToggleVisibility={() => toggleTrackerVisibility(tn)}
                onOpenCreateGroup={() => setGroupModal({ trackerName: tn })}
                onOpenEditGroup={(gid, gname, members) => setGroupModal({ trackerName: tn, editGroupId: gid, initialName: gname, initialSelected: members })}
                onToggleGroupCollapse={gid => toggleGroupCollapsed(tn, gid)}
                onToggleGroupVisibility={gid => toggleGroupVisibility(tn, gid)}
                onDeleteGroup={gid => deleteGroup(tn, gid)}
                onRenameGroup={(gid, name) => renameGroup(tn, gid, name)}
                onToggleDeviceVisibility={did => toggleDeviceVisibility(tn, did)}
                onSelectDevice={handleSelectDevice}
                onNavMode={handleNavMode}
                onExitNav={handleExitNav}
              />
            )
          })
        )}
      </div>

      {groupModal && (() => {
        const tn           = groupModal.trackerName
        const tDevices     = devicesByTracker[tn] ?? []
        const deviceGroups = trackerMeta[tn]?.deviceGroups ?? {}
        const groups       = trackerMeta[tn]?.groups ?? []
        // In edit mode, exclude this group's own members from "inOtherGroup" check
        const filteredGroups = groupModal.editGroupId
          ? Object.fromEntries(Object.entries(deviceGroups).filter(([, gid]) => gid !== groupModal.editGroupId))
          : deviceGroups
        return (
          <GroupModal
            open
            trackerName={tn}
            editGroupId={groupModal.editGroupId}
            initialName={groupModal.initialName}
            initialSelected={groupModal.initialSelected}
            devices={tDevices}
            deviceGroups={filteredGroups}
            groups={groups}
            onConfirm={(name, ids) => handleGroupConfirm(tn, name, ids, groupModal.editGroupId)}
            onCancel={() => setGroupModal(null)}
          />
        )
      })()}
    </div>
  )
}

// ── TrackerSection ────────────────────────────────────────────────────────────
interface TrackerSectionProps {
  trackerName: string; trackerColor: string; trackerDevices: Device[]
  groups: DeviceGroup[]; deviceGroups: Record<string, string>
  isCollapsed: boolean; isHiddenT: boolean
  trackerMeta: Record<string, any>; setDeviceOrder: (tn: string, o: string[]) => void
  collapsedGroups: Record<string, boolean>; hiddenGroups: Record<string, boolean>; hiddenDevices: Record<string, boolean>
  selectedDeviceId: string | null; followMode: FollowMode; followTrackerName: string | null
  onToggleCollapse: () => void; onToggleVisibility: () => void
  onOpenCreateGroup: () => void
  onOpenEditGroup: (gid: string, name: string, members: string[]) => void
  onToggleGroupCollapse: (gid: string) => void
  onToggleGroupVisibility: (gid: string) => void; onDeleteGroup: (gid: string) => void
  onRenameGroup: (gid: string, name: string) => void; onToggleDeviceVisibility: (did: string) => void
  onSelectDevice: (did: string, tn: string) => void
  onNavMode: () => void
  onExitNav: () => void
}

function TrackerSection({
  trackerName, trackerColor, trackerDevices, groups, deviceGroups,
  isCollapsed, isHiddenT, collapsedGroups, hiddenGroups, hiddenDevices,
  selectedDeviceId, followMode, followTrackerName,
  onToggleCollapse, onToggleVisibility, onOpenCreateGroup, onOpenEditGroup,
  onToggleGroupCollapse, onToggleGroupVisibility, onDeleteGroup, onRenameGroup,
  onToggleDeviceVisibility, onSelectDevice, onNavMode,
}: TrackerSectionProps) {

  // Each group + ungrouped has its own sort state
  const [groupSorts, setGroupSorts] = useState<Record<string, SortOrder>>({})
  const [ungroupedSort, setUngroupedSort] = useState<SortOrder>('activity')
  const getGroupSort = (gid: string): SortOrder => groupSorts[gid] ?? 'activity'
  const setGroupSort = (gid: string, v: SortOrder) => setGroupSorts(p => ({ ...p, [gid]: v }))

  const savedOrder = trackerMeta[trackerName]?.deviceOrder ?? []
  const { order, saveOrder } = useManualOrder(
    trackerName,
    trackerDevices.map(d => d.deviceId),
    savedOrder,
    (o) => setDeviceOrder(trackerName, o)
  )

  const sortDevices = (devs: Device[], sortOrder: SortOrder): Device[] => {
    if (sortOrder === 'manual') {
      const map = new Map(devs.map(d => [d.deviceId, d]))
      return order.map(id => map.get(id)).filter(Boolean) as Device[]
    }
    return [...devs].sort((a, b) =>
      sortOrder === 'alpha'
        ? a.deviceId.localeCompare(b.deviceId)
        : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  const renderDevice = (d: Device, isGHidden = false) => (
    <DeviceItem
      key={`${d.trackerName}/${d.deviceId}`} d={d} trackerColor={trackerColor}
      isTrackerHidden={isHiddenT} isGroupHidden={isGHidden}
      isSelected={d.deviceId === selectedDeviceId && d.trackerName === followTrackerName}
      followMode={d.deviceId === selectedDeviceId && d.trackerName === followTrackerName ? followMode : 'none'}
      isHidden={!!hiddenDevices[`${d.trackerName}/${d.deviceId}`]}
      onToggleVisibility={() => onToggleDeviceVisibility(d.deviceId)}
      onSelect={() => onSelectDevice(d.deviceId, d.trackerName)}
      onNavMode={() => onNavMode(d.deviceId, d.trackerName)}
    />
  )

  return (
    <div className="tracker-group">
      <div className="tracker-group__header">
        <div className="tracker-group__left" onClick={onToggleCollapse}>
          {isCollapsed ? <RightOutlined className="tracker-group__chevron" /> : <DownOutlined className="tracker-group__chevron" />}
          <ApartmentOutlined style={{ color: trackerColor, fontSize: 13 }} />
          <div className="vehicle-item__info">
            <Typography.Text strong ellipsis style={{ maxWidth: 110, fontSize: 13 }}>{trackerName}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {trackerDevices.length} dispositivo{trackerDevices.length !== 1 ? 's' : ''}
            </Typography.Text>
          </div>
        </div>
        <div className="tracker-group__actions">
          <Tooltip title="Nuevo grupo" mouseEnterDelay={0.4}>
            <Button size="small" type="text" icon={<PlusOutlined />} style={{ width: 24, height: 24 }} onClick={onOpenCreateGroup} />
          </Tooltip>
          <Button size="small" type="text" icon={isHiddenT ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            style={{ width: 24, height: 24 }} onClick={onToggleVisibility} />
        </div>
      </div>

      {!isCollapsed && (
        <div className="tracker-group__devices">

          {/* ── Named groups ── */}
          {groups.map(group => {
            const gk       = `${trackerName}/${group.id}`
            const isGC     = !!collapsedGroups[gk]
            const isGH     = !!hiddenGroups[gk]
            const gSort    = getGroupSort(group.id)
            const allGDevices = trackerDevices.filter(d => deviceGroups[d.deviceId] === group.id)
            const gDevices = sortDevices(allGDevices, gSort)
            const gOrder   = order.filter(id => allGDevices.some(d => d.deviceId === id))
            const members  = allGDevices.map(d => d.deviceId)

            return (
              <div key={group.id} className="device-group">
                <div className="device-group__header">
                  <div className="device-group__left" onClick={() => onToggleGroupCollapse(group.id)}>
                    {isGC ? <RightOutlined style={{ fontSize: 9 }} /> : <DownOutlined style={{ fontSize: 9 }} />}
                    <FolderOutlined style={{ color: trackerColor, fontSize: 11, opacity: 0.75 }} />
                    <InlineEdit value={group.name} onSave={name => onRenameGroup(group.id, name)} />
                    <Typography.Text type="secondary" style={{ fontSize: 10 }}>({allGDevices.length})</Typography.Text>
                  </div>
                  <div style={{ display: 'flex', gap: 1 }}>
                    <Tooltip title="Editar grupo" mouseEnterDelay={0.4}>
                      <Button size="small" type="text" icon={<EditOutlined />}
                        style={{ width: 22, height: 22 }}
                        onClick={() => onOpenEditGroup(group.id, group.name, members)} />
                    </Tooltip>
                    <Button size="small" type="text" icon={isGH ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                      style={{ width: 22, height: 22 }} onClick={() => onToggleGroupVisibility(group.id)} />
                    <Tooltip title="Eliminar grupo" mouseEnterDelay={0.4}>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />}
                        style={{ width: 22, height: 22 }} onClick={() => onDeleteGroup(group.id)} />
                    </Tooltip>
                  </div>
                </div>

                {!isGC && (
                  <div className="device-group__devices">
                    {/* Sort bar per group */}
                    <SortBar sortOrder={gSort} onSet={v => setGroupSort(group.id, v)} />
                    {gDevices.length === 0 ? (
                      <Typography.Text type="secondary" style={{ fontSize: 11, padding: '4px 8px', display: 'block' }}>Sin vehículos</Typography.Text>
                    ) : gSort === 'manual' ? (
                      <DraggableDeviceList devices={gDevices} order={gOrder}
                        onReorder={newO => { const rest = order.filter(id => !allGDevices.some(d => d.deviceId === id)); saveOrder([...newO, ...rest]) }}
                        renderDevice={d => renderDevice(d, isGH)} />
                    ) : gDevices.map(d => renderDevice(d, isGH))}
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Ungrouped ── */}
          {(() => {
            const allUngrouped = trackerDevices.filter(d => !deviceGroups[d.deviceId])
            if (!allUngrouped.length) return null
            const uDevices = sortDevices(allUngrouped, ungroupedSort)
            const uOrder   = order.filter(id => allUngrouped.some(d => d.deviceId === id))
            return (
              <div className="device-group__ungrouped">
                {groups.length > 0 && (
                  <div className="device-group__ungrouped-label">
                    <Typography.Text type="secondary" style={{ fontSize: 10 }}>Sin grupo</Typography.Text>
                  </div>
                )}
                <SortBar sortOrder={ungroupedSort} onSet={setUngroupedSort} />
                {ungroupedSort === 'manual' ? (
                  <DraggableDeviceList devices={uDevices} order={uOrder}
                    onReorder={newO => { const rest = order.filter(id => !allUngrouped.some(d => d.deviceId === id)); saveOrder([...rest, ...newO]) }}
                    renderDevice={d => renderDevice(d, false)} />
                ) : uDevices.map(d => renderDevice(d, false))}
              </div>
            )
          })()}

          {trackerDevices.length === 0 && (
            <Typography.Text type="secondary" className="tracker-group__empty">Sin dispositivos</Typography.Text>
          )}
        </div>
      )}
    </div>
  )
}

// ── DeviceItem ────────────────────────────────────────────────────────────────
interface DeviceItemProps {
  d: Device; trackerColor: string; isTrackerHidden: boolean; isGroupHidden: boolean
  isSelected: boolean; followMode: FollowMode; isHidden: boolean
  onToggleVisibility: () => void; onSelect: () => void; onNavMode: () => void; onExitNav: () => void
}

function DeviceItem({ d, trackerColor, isTrackerHidden, isGroupHidden, isSelected, followMode, isHidden, onToggleVisibility, onSelect, onNavMode, onExitNav }: DeviceItemProps) {
  const { text, offline } = timeLabel(d.updatedAt)
  const mins     = Math.floor((Date.now() - new Date(d.updatedAt).getTime()) / 60_000)
  const isActive = !offline && mins < 5
  const isFollowing = isSelected && followMode !== 'none'
  const isNavMode   = isSelected && followMode === 'navigation'

  return (
    <div
      className={['vehicle-item', isSelected ? 'vehicle-item--selected' : '', isFollowing ? 'vehicle-item--following' : '',
        isHidden || isTrackerHidden || isGroupHidden ? 'vehicle-item--hidden' : ''].filter(Boolean).join(' ')}
      style={isFollowing ? { borderLeft: `3px solid ${trackerColor}` } : undefined}
      onClick={onSelect}
    >
      <div className="vehicle-item__tracker-strip" style={{ backgroundColor: trackerColor }} />
      <CarOutlined className="vehicle-item__icon" style={{ color: trackerColor }} />
      <div className="vehicle-item__info">
        <Typography.Text strong ellipsis style={{ maxWidth: 100, fontSize: 12 }}>{d.deviceId}</Typography.Text>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {d.speed != null && <Typography.Text type="secondary" style={{ fontSize: 11 }}>{Math.round(d.speed)} km/h</Typography.Text>}
          {d.speed != null && <span style={{ fontSize: 9, color: 'rgba(128,128,128,0.4)' }}>·</span>}
          <Typography.Text style={{ fontSize: 11, color: offline ? '#ef4444' : 'rgba(128,128,128,0.7)', fontWeight: offline ? 500 : 400 }}>
            {text}
          </Typography.Text>
        </div>
      </div>

      {/* Botón modo conducción — visible en overview */}
      {isSelected && !isNavMode && (
        <Tooltip title="Modo conducción" mouseEnterDelay={0.3}>
          <Button size="small" type="text"
            style={{ width: 22, height: 22, flexShrink: 0, color: trackerColor }}
            onClick={e => { e.stopPropagation(); onNavMode() }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 22,20 12,16 2,20"/></svg>
          </Button>
        </Tooltip>
      )}
      {/* Botón salir conducción → vuelve a overview */}
      {isNavMode && (
        <Tooltip title="Volver a vista aérea" mouseEnterDelay={0.3}>
          <Button size="small" type="text"
            style={{ width: 22, height: 22, flexShrink: 0, color: trackerColor }}
            onClick={e => { e.stopPropagation(); onExitNav() }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          </Button>
        </Tooltip>
      )}

      <Button size="small" type="text" icon={isHidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
        style={{ width: 22, height: 22, flexShrink: 0 }}
        onClick={e => { e.stopPropagation(); onToggleVisibility() }} />

      <span className={`vehicle-status-dot${isActive ? ' vehicle-status-dot--active' : offline ? ' vehicle-status-dot--offline' : ''}`} />
    </div>
  )
}
