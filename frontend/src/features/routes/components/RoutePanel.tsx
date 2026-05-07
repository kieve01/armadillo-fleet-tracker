import { PlusOutlined, UndoOutlined, SaveOutlined } from '@ant-design/icons'
import { Alert, Button, Divider, Spin, Typography } from 'antd'
import { useEffect } from 'react'
import { useRoutesStore } from '../routesStore'
import RouteFormModal from './RouteFormModal'
import RouteListItem from './RouteListItem'
import '../../../styles/routes.css'

export default function RoutePanel() {
  const routes = useRoutesStore((state) => state.routes)
  const loading = useRoutesStore((state) => state.loading)
  const error = useRoutesStore((state) => state.error)
  const phase = useRoutesStore((state) => state.phase)
  const draftWaypoints = useRoutesStore((state) => state.draftWaypoints)
  const selectedRouteId = useRoutesStore((state) => state.selectedRouteId)
  const fetchRoutes = useRoutesStore((state) => state.fetchRoutes)
  const startDrawing = useRoutesStore((state) => state.startDrawing)
  const undoDraftWaypoint = useRoutesStore((state) => state.undoDraftWaypoint)
  const beginConfirmSave = useRoutesStore((state) => state.beginConfirmSave)
  const closeConfirm = useRoutesStore((state) => state.closeConfirm)
  const cancelDraft = useRoutesStore((state) => state.cancelDraft)
  const selectRoute = useRoutesStore((state) => state.selectRoute)

  useEffect(() => {
    fetchRoutes()

    return () => {
      cancelDraft()
    }
  }, [fetchRoutes, cancelDraft])

  const isDrawing = phase === 'drawing'
  const modalOpen = phase === 'confirming'

  return (
    <div className="route-panel">
      <div className="route-panel__toolbar">
        {!isDrawing ? (
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            className="route-panel__new-button"
            onClick={startDrawing}
          >
            Nueva ruta
          </Button>
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
                size="small"
                type="primary"
                icon={<SaveOutlined />}
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

      {error && <Alert type="error" message={error} showIcon style={{ margin: '0 12px 8px' }} />}

      <div className="route-panel__list">
        {loading && !routes.length ? (
          <div className="route-panel__loading">
            <Spin size="small" />
          </div>
        ) : routes.length === 0 ? (
          <Typography.Text type="secondary" className="route-panel__empty">
            No hay rutas guardadas
          </Typography.Text>
        ) : (
          routes.map((route) => (
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