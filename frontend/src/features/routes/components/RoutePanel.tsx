import { PlusOutlined, UndoOutlined, SaveOutlined, CalculatorOutlined } from '@ant-design/icons'
import { Alert, Button, Divider, Spin, Typography } from 'antd'
import { useEffect } from 'react'
import { useRoutesStore } from '../routesStore'
import RouteFormModal from './RouteFormModal'
import RouteListItem from './RouteListItem'
import '../../../styles/routes.css'

// El panel de calculador se abre a nivel de mapa, controlado desde aquí
// a través del store para no romper el layout del sidebar
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
              onClick={startDrawing}
              style={{ flex: 1 }}
            >
              Trazar ruta
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<CalculatorOutlined />}
              onClick={onOpenCalculator}
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
