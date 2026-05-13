import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type MapStyle  = 'Standard' | 'Hybrid' | 'Satellite'
export type ThemeMode = 'light' | 'dark'

interface UIState {
  sidebarCollapsed: boolean
  trafficEnabled:   boolean
  mapStyle:         MapStyle
  themeMode:        ThemeMode
  darkMap:          boolean
  toggleSidebar:    () => void
  toggleTraffic:    () => void
  setMapStyle:      (style: MapStyle) => void
  toggleTheme:      () => void
  setTheme:         (mode: ThemeMode) => void
  toggleDarkMap:    () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      trafficEnabled:   false,
      mapStyle: 'Hybrid' as MapStyle,
      themeMode:        'light'  as ThemeMode,
      darkMap:          false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleTraffic: () => set((s) => ({ trafficEnabled:   !s.trafficEnabled   })),
      setMapStyle:   (style: MapStyle)  => set({ mapStyle: style }),
      toggleTheme:   () => set((s) => ({ themeMode: s.themeMode === 'dark' ? 'light' : 'dark' })),
      setTheme:      (mode: ThemeMode)  => set({ themeMode: mode }),
      toggleDarkMap: () => set((s) => ({ darkMap: !s.darkMap })),
    }),
    {
      name: 'armadillo-ui',
      partialize: (s) => ({
        themeMode: s.themeMode,
        mapStyle:  s.mapStyle,
        darkMap:   s.darkMap,
      }),
    }
  )
)
