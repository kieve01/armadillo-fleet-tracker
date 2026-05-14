import { useEffect, useCallback } from 'react'
import { Layout } from 'antd'
import Sidebar from './Sidebar'
import MapView from '../map/MapView'
import { useUIStore } from '../../store/uiStore'
import { useMapStore } from '../../store/mapStore'
import { useGeofencesStore } from '../../features/geofences/geofencesStore'
import { useRoutesStore } from '../../features/routes/routesStore'

const COLLAPSE_BREAKPOINT = 768

export default function AppShell() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const themeMode        = useUIStore((s) => s.themeMode)
  const setSidebarCollapsed = useUIStore((s) => s.toggleSidebar)
  const map              = useMapStore((s) => s.map)

  // Resize mapa al colapsar/expandir sidebar
  useEffect(() => {
    if (!map) return
    const timer = setTimeout(() => map.resize(), 220)
    return () => clearTimeout(timer)
  }, [sidebarCollapsed, map])

  // Aplica data-theme al body
  useEffect(() => {
    document.body.setAttribute('data-theme', themeMode)
  }, [themeMode])

  // ESC global — cancela cualquier dibujo activo (geocercas o rutas)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // No cancelar si hay un input/textarea enfocado (ej. InlineEdit, modals)
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const { phase: gPhase, cancelDraft: gCancel } = useGeofencesStore.getState()
      if (gPhase === 'drawing') { gCancel(); return }
      const { phase: rPhase, cancelDraft: rCancel } = useRoutesStore.getState()
      if (rPhase === 'drawing') { rCancel(); return }
      if (rPhase === 'calculating') { useRoutesStore.getState().cancelCalculating(); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Responsive: colapsa sidebar si ventana < breakpoint
  const handleResize = useCallback(() => {
    const narrow = window.innerWidth < COLLAPSE_BREAKPOINT
    const { sidebarCollapsed: current } = useUIStore.getState()
    if (narrow && !current) setSidebarCollapsed()
  }, [setSidebarCollapsed])

  useEffect(() => {
    // Check on mount
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [handleResize])

  return (
    <Layout style={{ width: '100%', height: '100%' }}>
      <Sidebar />
      <Layout.Content style={{ position: 'relative', overflow: 'hidden', minWidth: 0 }}>
        <MapView />
      </Layout.Content>
    </Layout>
  )
}
