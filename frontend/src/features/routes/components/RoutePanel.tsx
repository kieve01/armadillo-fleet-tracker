import { PlusOutlined, UndoOutlined, SaveOutlined, CalculatorOutlined } from '@ant-design/icons'
import { Alert, Button, Divider, Spin, Typography } from 'antd'
import { useEffect } from 'react'
import { useRoutesStore } from '../routesStore'
import { useVehiclesStore } from '../../vehicles/vehiclesStore'
import { useMapStore } from '../../../store/mapStore'
import RouteFormModal from './RouteFormModal'
import RouteListItem from './RouteListItem'
import '../../../styles/routes.css'

const LIMA_CENTER: [number, number] = [-77.03, -12.06]
const LIMA_ZOOM = 10

function fitFleetAndClearFollow() {
  useVehiclesStore.getState().setFollow(null, null, 'none')
  const map = useMapStore.getState().map
  if (!map) return
  const devices = useVehiclesStore.getState().devices
  const lima = devices.filter(d =>
    d.lat >= -12.55 && d.lat <= -11.75 &&
    d.lng >= -77.35 && d.lng <= -76.70
  )
  const targets = lima.length ? lima : devices
  if (!targets.length) {
    map.flyTo({ center: LIMA_CENTER, zoom: LIMA_ZOOM, bearing: 0, pitch: 0 })
    return
  }
  const lngs = targets.map(d => d.lng)
  const lats  = targets.map(d => d.lat)
  if (targets.length === 1) {
    map.flyTo({ center: [lngs[0], lats[0]], zoom: 14, bearing: 0, pitch: 0 })
  } else {
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 80, maxZoom: 13, bearing: 0, pitch: 0 }
    )
  }
}

interface Props { onOpenCalculator: () => void }

export default function RoutePanel({ onOpenCalculator }: Props) {
  const routes          = useRoutesStore(s => s.routes)
  const loading         = useRoutesStore(s => s.loading)
  const error           = useRoutesStore(s => s.error)
  const phase           = useRoutesStore(s => s.phase)
  const draftWaypoints  = useRoutesStore(s => s.draftWaypoints)
  const selectedRouteId = useRoutesStore(s => s.selectedRouteId)
  const fetchRoutes     = useRoutesStore(s => s.fetchRoutes)
  const startDrawing    = useRoutesStore(s => s.startDrawing)
  const undoDraftWaypoint = useRoutesStore(s => s.undoDraftWaypoint)
  const beginConfirmSave  = useRoutesStore(s => s.beginConfirmSave)
  const closeConfirm      = useRoutesStore(s => s.closeConfirm)
  const cancelDraft       = useRoutesStore(s => s.cancelDraft)
  const selectRoute       = useRoutesStore(s => s.selectRoute)

  useEffect(() => {
    fetchRoutes()
    return () => { cancelDraft() }
  }, [fetchRoutes, cancelDraft])

  const isDrawing = phase === 'drawing'
  const modalOpen = phase === 'confirming'

  return (
    <div className="route-panel">
      <div className="route-panel__toolbar">
        {!isDrawing ? (
          <div style={{ display: 'flex', gap: 6, width: '100%' }}>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => { fitFleetAndClearFollow(); startDrawing() }}
              style={{ flex: 1 }}
            >
              Trazar ruta
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<CalculatorOutlined />}
              onClick={() => { fitFleetAndClearFollow(); onOpenCalculator() }}
              style={{ flex: 1 }}
            >
              Calcular ruta
            </Button>
          </div>
        ) : (
          <div className="route-panel__draft">
            <div className="route-panel__draft-message">
              <Typography.Text className="route-panel__draft-title">
                Modo dibujo activo
              </Typography.Text>
              <Typography.Text type="secondary" className="route-panel__draft-subtitle">
                Click para agregar puntos. Doble click en el mapa para confirmar.
              </Typography.Text>
            </div>
            <div className="route-panel__actions">
              <Button size="small" icon={<UndoOutlined />} onClick={undoDraftWaypoint}>
                Deshacer
              </Button>
              <Button
                size="small" type="primary" icon={<SaveOutlined />}
                onClick={beginConfirmSave}
                disabled={draftWaypoints.length < 2}
              >
                Guardar
              </Button>
              <Button size="small" onClick={cancelDraft}>Cancelar</Button>
            </div>
          </div>
        )}
      </div>

      {isDrawing && (
        <Typography.Text type="secondary" className="route-panel__hint">
          Puntos: {draftWaypoints.length}
        </Typography.Text>
      )}

      <Divider style={{ margin: '8px 0' }} />

      {error && <Alert type="error" title={error} showIcon style={{ margin: '0 12px 8px' }} />}

      <div className="route-panel__list">
        {loading && !routes.length ? (
          <div className="route-panel__loading"><Spin size="small" /></div>
        ) : routes.length === 0 ? (
          <Typography.Text type="secondary" className="route-panel__empty">
            No hay rutas guardadas
          </Typography.Text>
        ) : (
          routes.map(route => (
            <RouteListItem
              key={route.routeId}
              route={route}
              isSelected={selectedRouteId === route.routeId}
              onSelectRoute={selectRoute}
            />
          ))
        )}
      </div>

      <RouteFormModal open={modalOpen} onCancel={closeConfirm} />
    </div>
  )
}
