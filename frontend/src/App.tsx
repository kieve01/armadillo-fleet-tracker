import { ConfigProvider, theme as antTheme } from 'antd'
import esES from 'antd/locale/es_ES'
import AppShell from './components/layout/AppShell'
import { useUIStore } from './store/uiStore'

const COLOR_PRIMARY      = '#00418b'
const COLOR_PRIMARY_DARK = '#4a9fd4'

export default function App() {
  const themeMode = useUIStore((s) => s.themeMode)
  const isDark    = themeMode === 'dark'

  return (
    <ConfigProvider
      locale={esES}
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: {
          colorPrimary:    isDark ? COLOR_PRIMARY_DARK : COLOR_PRIMARY,
          borderRadius:    6,
          fontFamily:      "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          // Dark mode: fondo más suave, no el negro puro de Ant Design por defecto
          ...(isDark && {
            colorBgBase:       '#1a1f2e',
            colorBgContainer:  '#1e2435',
            colorBgElevated:   '#252b3d',
            colorBgLayout:     '#141824',
            colorBorder:       '#2e3650',
            colorBorderSecondary: '#252b3d',
            colorText:         '#e2e8f0',
            colorTextSecondary:'#94a3b8',
            colorTextTertiary: '#64748b',
            colorTextQuaternary:'#475569',
          }),
        },
        components: {
          Layout: {
            siderBg: isDark ? '#1e2435' : '#ffffff',
            bodyBg:  isDark ? '#141824' : '#f5f5f5',
          },
          Menu: {
            darkItemBg:         '#1e2435',
            darkSubMenuItemBg:  '#252b3d',
          },
        },
      }}
    >
      <AppShell />
    </ConfigProvider>
  )
}
