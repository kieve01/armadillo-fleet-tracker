import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Popconfirm, Spin, Tooltip, Typography } from 'antd'
import {
  CarOutlined,
  PlusOutlined,
  DeleteOutlined,
  ApartmentOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  DownOutlined,
  RightOutlined,
  SortAscendingOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { useVehiclesStore } from '../vehiclesStore'
import { useMapStore } from '../../../store/mapStore'
import PlaceDeviceModal from './PlaceDeviceModal'
import CreateTrackerModal from './CreateTrackerModal'

function colorFromTracker(trackerName: string): string {
  const palette = ['#00418b', '#0f766e', '#9a3412', '#6d28d9', '#0369a1', '#be123c']
  let hash = 0
  for (let i = 0; i < trackerName.length; i += 1) {
    hash = (hash << 5) - hash + trackerName.charCodeAt(i)
    hash |= 0
  }
  return palette[Math.abs(hash) % palette.length]
}

export default function VehiclePanel() {
  const trackerResources    = useVehiclesStore((s) => s.trackerResources)
  const devices             = useVehiclesStore((s) => s.devices)
  const loading             = useVehiclesStore((s) => s.loading)
  const error               = useVehiclesStore((s) => s.error)
  const selectedDeviceId    = useVehiclesStore((s) => s.selectedDeviceId)
  const phase               = useVehiclesStore((s) => s.phase)
  const pendingLocation     = useVehiclesStore((s) => s.pendingLocation)
  const collapsedTrackers   = useVehiclesStore((s) => s.collapsedTrackers)
  const hiddenTrackers      = useVehiclesStore((s) => s.hiddenTrackers)
  const hiddenDevices       = useVehiclesStore((s) => s.hiddenDevices)
  const deleteTracker       = useVehiclesStore((s) => s.deleteTracker)
  const deleteDevice        = useVehiclesStore((s) => s.deleteDevice)
  const startPlace          = useVehiclesStore((s) => s.startPlace)
  const cancelPlace         = useVehiclesStore((s) => s.cancelPlace)
  const selectDevice        = useVehiclesStore((s) => s.selectDevice)
  const toggleTrackerCollapsed   = useVehiclesStore((s) => s.toggleTrackerCollapsed)
  const toggleTrackerVisibility  = useVehiclesStore((s) => s.toggleTrackerVisibility)
  const toggleDeviceVisibility   = useVehiclesStore((s) => s.toggleDeviceVisibility)
  const map = useMapStore((s) => s.map)

  const [createTrackerOpen, setCreateTrackerOpen] = useState(false)
  const [sortOrder, setSortOrder] = useState<'activity' | 'alpha'>('activity')

  useEffect(() => { return () => { cancelPlace() } }, [cancelPlace])

  const flyToDevice = (deviceId: string, trackerName: string) => {
    const d = devices.find((d) => d.deviceId === deviceId && d.trackerName === trackerName)
    if (d && map) map.flyTo({ center: [d.lng, d.lat], zoom: 15 })
    selectDevice(deviceId)
  }

  const isPlacing      = phase === 'placing'
  const placeModalOpen = isPlacing && pendingLocation !== null

  const devicesByTracker = useMemo(() => {
    const groups: Record<string, typeof devices> = {}
    for (const device of devices) {
      if (!groups[device.trackerName]) groups[device.trackerName] = []
      groups[device.trackerName].push(device)
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) =>
        sortOrder === 'alpha'
          ? a.deviceId.localeCompare(b.deviceId)
          : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
    }
    return groups
  }, [devices, sortOrder])

  return (
    <div className="vehicle-panel">

      {/* ── Toolbar ── */}
      <div className="vehicle-panel__toolbar">
        {!isPlacing ? (
          <>
            {/* Row 1: actions */}
            <div style={{ display: 'flex', gap: 6, width: '100%' }}>
              <Button
                size="small"
                icon={<ApartmentOutlined />}
                onClick={() => setCreateTrackerOpen(true)}
                style={{ flex: 1 }}
              >
                Tracker
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<PlusOutlined />}
                onClick={startPlace}
                disabled={trackerResources.length === 0}
                style={{ flex: 1 }}
              >
                Vehículo
              </Button>

              {/* Sort toggle — icon buttons, right-aligned */}
              <div className="vehicle-sort-toggle">
                <Tooltip title="Ordenar por actividad" mouseEnterDelay={0.4}>
                  <button
                    className={`vehicle-sort-btn${sortOrder === 'activity' ? ' vehicle-sort-btn--active' : ''}`}
                    onClick={() => setSortOrder('activity')}
                    aria-label="Ordenar por actividad"
                  >
                    <ClockCircleOutlined />
                  </button>
                </Tooltip>
                <Tooltip title="Ordenar alfabéticamente" mouseEnterDelay={0.4}>
                  <button
                    className={`vehicle-sort-btn${sortOrder === 'alpha' ? ' vehicle-sort-btn--active' : ''}`}
                    onClick={() => setSortOrder('alpha')}
                    aria-label="Ordenar alfabéticamente"
                  >
                    <SortAscendingOutlined />
                  </button>
                </Tooltip>
              </div>
            </div>
          </>
        ) : (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Haz click en el mapa
            </Typography.Text>
            <Button size="small" onClick={cancelPlace}>Cancelar</Button>
          </>
        )}
      </div>

      {error && <Alert type="error" message={error} showIcon style={{ margin: '8px 12px' }} />}

      {/* ── List ── */}
      <div className="vehicle-panel__list">
        {loading && !devices.length ? (
          <div className="vehicle-panel__loading"><Spin size="small" /></div>
        ) : trackerResources.length === 0 ? (
          <Typography.Text type="secondary" className="vehicle-panel__empty">
            Crea un tracker primero
          </Typography.Text>
        ) : (
          trackerResources.map((tracker) => {
            const trackerName    = tracker.trackerName
            const trackerDevices = devicesByTracker[trackerName] ?? []
            const isCollapsed    = !!collapsedTrackers[trackerName]
            const isTrackerHidden = !!hiddenTrackers[trackerName]
            const trackerColor   = colorFromTracker(trackerName)

            return (
              <div key={trackerName} className="tracker-group">
                <div className="tracker-group__header">
                  <div className="tracker-group__left" onClick={() => toggleTrackerCollapsed(trackerName)}>
                    {isCollapsed
                      ? <RightOutlined className="tracker-group__chevron" />
                      : <DownOutlined  className="tracker-group__chevron" />
                    }
                    <ApartmentOutlined style={{ color: trackerColor, fontSize: 14 }} />
                    <div className="vehicle-item__info">
                      <Typography.Text strong ellipsis style={{ maxWidth: 110, fontSize: 13 }}>
                        {trackerName}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {trackerDevices.length} dispositivo{trackerDevices.length !== 1 ? 's' : ''}
                      </Typography.Text>
                    </div>
                  </div>
                  <div className="tracker-group__actions">
                    <Button
                      size="small" type="text"
                      icon={isTrackerHidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                      onClick={() => toggleTrackerVisibility(trackerName)}
                    />
                    <Popconfirm
                      title="¿Eliminar tracker?"
                      description="Se eliminará el tracker y todos sus datos."
                      okText="Eliminar" cancelText="Cancelar"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => deleteTracker(trackerName)}
                    >
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="tracker-group__devices">
                    {trackerDevices.length === 0 ? (
                      <Typography.Text type="secondary" className="tracker-group__empty">
                        Sin dispositivos
                      </Typography.Text>
                    ) : (
                      trackerDevices.map((d) => {
                        const isSelected    = d.deviceId === selectedDeviceId
                        const key           = `${d.trackerName}/${d.deviceId}`
                        const isDeviceHidden = !!hiddenDevices[key]
                        const minutesAgo    = Math.floor((Date.now() - new Date(d.updatedAt).getTime()) / 60_000)
                        const isActive      = minutesAgo < 5

                        return (
                          <div
                            key={key}
                            className={`vehicle-item${isSelected ? ' vehicle-item--selected' : ''}${isDeviceHidden || isTrackerHidden ? ' vehicle-item--hidden' : ''}`}
                            onClick={() => flyToDevice(d.deviceId, d.trackerName)}
                          >
                            <div className="vehicle-item__tracker-strip" style={{ backgroundColor: trackerColor }} />
                            <CarOutlined className="vehicle-item__icon" />
                            <div className="vehicle-item__info">
                              <Typography.Text strong ellipsis style={{ maxWidth: 100 }}>
                                {d.deviceId}
                              </Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                {d.speed != null ? `${Math.round(d.speed)} km/h · ` : ''}
                                {minutesAgo === 0 ? 'ahora' : `hace ${minutesAgo} min`}
                              </Typography.Text>
                            </div>
                            <Button
                              size="small" type="text"
                              icon={isDeviceHidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                              onClick={(e) => { e.stopPropagation(); toggleDeviceVisibility(d.trackerName, d.deviceId) }}
                            />
                            <Popconfirm
                              title="¿Eliminar vehículo?"
                              description="Se eliminará solo este dispositivo del tracker."
                              okText="Eliminar" cancelText="Cancelar"
                              okButtonProps={{ danger: true }}
                              onConfirm={() => deleteDevice(d.trackerName, d.deviceId)}
                            >
                              <Button
                                size="small" type="text" danger icon={<DeleteOutlined />}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </Popconfirm>
                            <span className={`vehicle-status-dot${isActive ? ' vehicle-status-dot--active' : ''}`} />
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <CreateTrackerModal open={createTrackerOpen} onClose={() => setCreateTrackerOpen(false)} />
      <PlaceDeviceModal open={placeModalOpen} onCancel={cancelPlace} />
    </div>
  )
}
