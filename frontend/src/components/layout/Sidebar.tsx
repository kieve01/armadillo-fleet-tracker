import { useState } from 'react'
import { Layout, theme, Tooltip, Typography, Badge } from 'antd'
import {
  TruckOutlined,
  NodeIndexOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined,
  ArrowLeftOutlined,
  BulbOutlined,
  BulbFilled,
  MenuOutlined,
} from '@ant-design/icons'
import { useUIStore } from '../../store/uiStore'
import GeofencePanel from '../../features/geofences/components/GeofencePanel'
import VehiclePanel from '../../features/vehicles/components/VehiclePanel'
import RoutePanel from '../../features/routes/components/RoutePanel'
import logoAmplio from '../../assets/icons/logo_armadillo_amplio.png'
import '../../styles/sidebar.css'

const { Sider } = Layout

interface NavItem { key: string; icon: React.ReactNode; label: string; badge?: number }

const navItems: NavItem[] = [
  { key: 'vehicles',  icon: <TruckOutlined />,            label: 'Vehículos'  },
  { key: 'geofences', icon: <SafetyCertificateOutlined />, label: 'Geocercas'  },
  { key: 'routes',    icon: <NodeIndexOutlined />,         label: 'Rutas'      },
  { key: 'reports',   icon: <FileTextOutlined />,          label: 'Reportes'   },
]

export default function Sidebar() {
  const collapsed     = useUIStore(s => s.sidebarCollapsed)
  const toggleSidebar = useUIStore(s => s.toggleSidebar)
  const themeMode     = useUIStore(s => s.themeMode)
  const toggleTheme   = useUIStore(s => s.toggleTheme)
  const isDark        = themeMode === 'dark'

  const { token } = theme.useToken()
  const [activePanel, setActivePanel] = useState<string | null>(null)

  const activeItem  = navItems.find(i => i.key === activePanel)
  const inSubmenu   = !!activePanel && !collapsed
  const borderStyle = `1px solid ${token.colorBorderSecondary}`

  const handleNavClick = (key: string) => {
    if (collapsed) { toggleSidebar(); setTimeout(() => setActivePanel(key), 10) }
    else setActivePanel(key)
  }

  return (
    <Sider
      collapsible collapsed={collapsed} trigger={null}
      width={280} collapsedWidth={56}
      style={{ background: token.colorBgContainer, borderRight: borderStyle }}
    >
      {/* ── Header: hamburguesa siempre visible + logo cuando expandido ── */}
      {/* ── Header: altura fija, hamburguesa fija, logo fade ── */}
      <div style={{
        borderBottom: borderStyle,
        height: 60,
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Hamburguesa: posición absoluta fija, siempre centrada en los 56px izquierdos */}
        <button
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 56,
            height: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: token.colorTextSecondary,
            borderRadius: 0,
            flexShrink: 0,
            zIndex: 1,
            transition: 'background 0.13s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(128,128,128,0.08)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <MenuOutlined style={{ fontSize: 17 }} />
        </button>

        {/* Logo: ocupa el espacio a la derecha del botón, fade cuando colapsa */}
        <div style={{
          marginLeft: 56,
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: collapsed ? 0 : 1,
          transform: collapsed ? 'translateX(-8px)' : 'translateX(0)',
          transition: 'opacity 0.18s ease, transform 0.18s ease',
          pointerEvents: collapsed ? 'none' : 'auto',
          paddingRight: 12,
          overflow: 'hidden',
        }}>
          <img
            src={logoAmplio}
            alt="Armadillo"
            style={{ width: 148, height: 'auto', objectFit: 'contain', flexShrink: 0 }}
          />
        </div>
      </div>

      {/* ── Sliding panels ── */}
      <div className="sidebar-panels">
        {/* Main nav */}
        <div className={`sidebar-panel sidebar-panel--main${inSubmenu ? ' sidebar-panel--hidden' : ''}`}>
          <nav className="sidebar-nav">
            {navItems.map(item => {
              const isActive = activePanel === item.key && !collapsed
              const el = (
                <div
                  key={item.key}
                  className={`sidebar-nav-item${isActive ? ' sidebar-nav-item--active' : ''}`}
                  style={{
                    color:      isActive ? token.colorPrimary : token.colorText,
                    background: isActive ? `${token.colorPrimary}12` : undefined,
                  }}
                  onClick={() => handleNavClick(item.key)}
                  role="button" tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && handleNavClick(item.key)}
                >
                  {!collapsed && (
                    <span className="sidebar-nav-item__bar"
                      style={{ background: isActive ? token.colorPrimary : 'transparent' }} />
                  )}
                  <span
                    className="sidebar-nav-item__icon"
                    style={{
                      color:        isActive ? token.colorPrimary : token.colorTextSecondary,
                      background:   collapsed && isActive ? `${token.colorPrimary}18` : undefined,
                      borderRadius: collapsed ? 8 : 0,
                      padding:      collapsed ? '6px' : '0',
                    }}
                  >
                    {item.icon}
                  </span>
                  {!collapsed && (
                    <>
                      <span className="sidebar-nav-item__label">{item.label}</span>
                      {item.badge != null && (
                        <Badge count={item.badge} size="small"
                          style={{ backgroundColor: token.colorPrimary }} />
                      )}
                      <span className="sidebar-nav-item__chevron"
                        style={{ color: isActive ? token.colorPrimary : token.colorTextQuaternary }}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor"
                            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>
                    </>
                  )}
                </div>
              )
              return collapsed
                ? <Tooltip key={item.key} title={item.label} placement="right" mouseEnterDelay={0.05}>{el}</Tooltip>
                : el
            })}
          </nav>
        </div>

        {/* Sub panel */}
        <div className={`sidebar-panel sidebar-panel--sub${inSubmenu ? ' sidebar-panel--active' : ''}`}>
          <div className="sidebar-subpanel__header" style={{ borderBottom: borderStyle }}>
            <button
              className="sidebar-subpanel__back"
              onClick={() => setActivePanel(null)}
              style={{ color: token.colorTextSecondary, background: token.colorFillTertiary, border: 'none' }}
              aria-label="Volver"
            >
              <ArrowLeftOutlined style={{ fontSize: 11 }} />
            </button>
            <span className="sidebar-subpanel__icon"
              style={{ color: token.colorPrimary, background: `${token.colorPrimary}15` }}>
              {activeItem?.icon}
            </span>
            <Typography.Text strong style={{ color: token.colorText, fontSize: 14, flex: 1 }}>
              {activeItem?.label}
            </Typography.Text>
          </div>
          <div className="sidebar-panel-content">
            {activePanel === 'vehicles'  && <VehiclePanel />}
            {activePanel === 'geofences' && <GeofencePanel />}
            {activePanel === 'routes'    && <RoutePanel />}
            {activePanel === 'reports'   && (
              <div className="sidebar-empty-state">
                <FileTextOutlined style={{ fontSize: 28, color: token.colorTextQuaternary }} />
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  Módulo en desarrollo
                </Typography.Text>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Footer: solo toggle de tema ── */}
      <div className="sidebar-footer" style={{ borderTop: borderStyle }}>
        <Tooltip
          title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          placement="right"
          mouseEnterDelay={0.15}
        >
          <div
            className={`sidebar-theme-toggle${collapsed ? ' sidebar-theme-toggle--collapsed' : ''}`}
            onClick={toggleTheme}
            style={{ color: token.colorTextSecondary }}
            role="button" tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && toggleTheme()}
          >
            <span className="sidebar-theme-toggle__icon">
              {isDark
                ? <BulbFilled style={{ color: '#f59e0b' }} />
                : <BulbOutlined style={{ color: token.colorTextTertiary }} />
              }
            </span>
            {!collapsed && (
              <span className="sidebar-theme-toggle__label" style={{ color: token.colorTextSecondary }}>
                {isDark ? 'Modo claro' : 'Modo oscuro'}
              </span>
            )}
          </div>
        </Tooltip>
      </div>
    </Sider>
  )
}
