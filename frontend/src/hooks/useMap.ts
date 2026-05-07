import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { buildStyleUrl } from '../components/map/mapHelpers'
import { useMapStore } from '../store/mapStore'
import { useUIStore } from '../store/uiStore'
import { useVehiclesStore } from '../features/vehicles/vehiclesStore'

const DEFAULT_CENTER: [number, number] = [-77.03, -12.06]
const DEFAULT_ZOOM = 10
const REGION  = import.meta.env.VITE_AWS_REGION as string
const API_KEY = import.meta.env.VITE_MAP_API_KEY as string

function getT(isDark: boolean) {
  return {
    bg:         isDark ? '#1e2435' : '#ffffff',
    bgHover:    isDark ? '#252b3d' : '#f4f6f9',
    bgActive:   isDark ? '#4a9fd4' : '#1a73e8',
    text:       isDark ? '#e2e8f0' : '#3c4043',
    textMuted:  isDark ? '#64748b' : '#b0b8c4',
    textActive: '#ffffff',
    border:     isDark ? '#2e3650' : 'rgba(0,0,0,0.10)',
    shadow:     isDark ? '0 4px 16px rgba(0,0,0,0.55)' : '0 2px 12px rgba(0,0,0,0.18)',
    divider:    isDark ? '#252b3d' : 'rgba(0,0,0,0.07)',
    moonBg:     isDark ? '#2e3a5c' : '#e8f0fe',
    moonColor:  isDark ? '#93c5fd' : '#1a73e8',
  }
}

const SVG = {
  map: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
  hybrid: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  satellite: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
  traffic: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="20" rx="3"/><circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  moon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  sun: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  layers: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
}

// ── MapTypeControl ────────────────────────────────────────────────────────────
class MapTypeControl implements maplibregl.IControl {
  private container?: HTMLDivElement
  private panel?: HTMLDivElement
  private toggleBtn?: HTMLButtonElement
  private expanded = false
  private unsub?: () => void

  onAdd(_map: maplibregl.Map): HTMLElement {
    this.container = document.createElement('div')
    this.container.style.cssText =
      'display:flex;flex-direction:column;align-items:flex-end;gap:6px;' +
      'margin:0 10px 10px 0;position:relative;z-index:10;pointer-events:auto;'

    // ── Toggle button ──
    this.toggleBtn = document.createElement('button')
    this.toggleBtn.title = 'Opciones de mapa'
    this.toggleBtn.style.cssText =
      'border:none;cursor:pointer;outline:none;border-radius:10px;' +
      'width:36px;height:36px;display:flex;align-items:center;justify-content:center;' +
      'transition:background 0.15s,box-shadow 0.15s,color 0.15s;flex-shrink:0;'
    this.toggleBtn.innerHTML = SVG.layers

    // ── Panel ──
    this.panel = document.createElement('div')
    this.panel.style.cssText =
      'border-radius:12px;overflow:hidden;width:0;opacity:0;pointer-events:none;' +
      'transition:width 0.22s cubic-bezier(0.4,0,0.2,1),opacity 0.18s;min-width:0;'

    // Helper: create a standard row
    const mkRow = (icon: string, label: string) => {
      const row = document.createElement('div')
      row.style.cssText =
        'display:flex;align-items:center;width:100%;cursor:pointer;' +
        'transition:background 0.12s,color 0.12s;'

      const iconWrap = document.createElement('span')
      iconWrap.style.cssText =
        'width:40px;height:38px;display:flex;align-items:center;justify-content:center;flex-shrink:0;'
      iconWrap.innerHTML = icon

      const labelEl = document.createElement('span')
      labelEl.style.cssText =
        'font-size:12px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'white-space:nowrap;flex:1;'
      labelEl.textContent = label

      row.appendChild(iconWrap)
      row.appendChild(labelEl)
      return { row, iconWrap, labelEl }
    }

    // ── Map row — special: has dark toggle on the right ──
    const { row: rowMap } = mkRow(SVG.map, 'Mapa')
    rowMap.style.paddingRight = '6px'

    // Dark map mini-button (hidden by default, shown when Map is active)
    const darkBtn = document.createElement('button')
    darkBtn.style.cssText =
      'border:none;cursor:pointer;outline:none;border-radius:7px;' +
      'width:26px;height:26px;display:none;align-items:center;justify-content:center;' +
      'margin-right:6px;flex-shrink:0;transition:background 0.13s,color 0.13s;'
    darkBtn.title = 'Alternar mapa oscuro'
    darkBtn.innerHTML = SVG.moon
    darkBtn.addEventListener('click', e => {
      e.stopPropagation()
      useUIStore.getState().toggleDarkMap()
    })
    rowMap.appendChild(darkBtn)

    rowMap.addEventListener('click', () => useUIStore.getState().setMapStyle('Standard'))

    // ── Hybrid row ──
    const { row: rowHybrid } = mkRow(SVG.hybrid, 'Satélite')
    rowHybrid.style.paddingRight = '12px'
    rowHybrid.addEventListener('click', () => useUIStore.getState().setMapStyle('Hybrid'))

    // ── Satellite row ──
    const { row: rowSat } = mkRow(SVG.satellite, 'Sat. puro')
    rowSat.style.paddingRight = '12px'
    rowSat.addEventListener('click', () => {
      const store = useUIStore.getState()
      if (store.trafficEnabled) store.toggleTraffic()
      store.setMapStyle('Satellite')
    })

    // ── Divider ──
    const div1 = document.createElement('div')
    div1.style.cssText = 'height:1px;margin:0 0;flex-shrink:0;'

    // ── Traffic row ──
    const { row: rowTraffic } = mkRow(SVG.traffic, 'Tráfico')
    rowTraffic.style.paddingRight = '12px'
    rowTraffic.addEventListener('click', () => useUIStore.getState().toggleTraffic())

    this.panel.appendChild(rowMap)
    this.panel.appendChild(rowHybrid)
    this.panel.appendChild(rowSat)
    this.panel.appendChild(div1)
    this.panel.appendChild(rowTraffic)

    this.toggleBtn.addEventListener('click', e => {
      e.stopPropagation()
      this.expanded ? this.collapse() : this.expand()
    })

    document.addEventListener('click', e => {
      if (this.expanded && !this.container!.contains(e.target as Node)) this.collapse()
    })

    this.container.appendChild(this.panel)
    this.container.appendChild(this.toggleBtn)

    // ── Sync function ──
    const sync = () => {
      const { mapStyle, themeMode, trafficEnabled, darkMap } = useUIStore.getState()
      const t = getT(themeMode === 'dark')
      const isStandard = mapStyle === 'Standard'

      // Toggle button
      this.toggleBtn!.style.background = this.expanded ? t.bgActive : t.bg
      this.toggleBtn!.style.color      = this.expanded ? t.textActive : t.text
      this.toggleBtn!.style.boxShadow  = t.shadow
      this.toggleBtn!.style.border     = `1px solid ${t.border}`

      // Panel shell
      this.panel!.style.background = t.bg
      this.panel!.style.boxShadow  = t.shadow
      this.panel!.style.border     = `1px solid ${t.border}`
      div1.style.background        = t.divider

      // Style each row
      const styleRow = (
        rowEl: HTMLDivElement,
        active: boolean,
      ) => {
        rowEl.style.background = active ? t.bgActive : t.bg
        rowEl.style.color      = active ? t.textActive : t.text
        // icon and label inherit color via currentColor
      }

      styleRow(rowMap,     isStandard)
      styleRow(rowHybrid,  mapStyle === 'Hybrid')
      styleRow(rowSat,     mapStyle === 'Satellite')
      const trafficDisabled = mapStyle === 'Satellite'
      styleRow(rowTraffic, trafficEnabled && !trafficDisabled)
      rowTraffic.style.opacity = trafficDisabled ? '0.4' : '1'
      rowTraffic.style.cursor  = trafficDisabled ? 'not-allowed' : 'pointer'

      // Hover listeners (re-attach so they use fresh t)
      const hoverRows: [HTMLDivElement, () => boolean][] = [
        [rowMap, () => useUIStore.getState().mapStyle === 'Standard'],
        [rowHybrid, () => useUIStore.getState().mapStyle === 'Hybrid'],
        [rowSat, () => useUIStore.getState().mapStyle === 'Satellite'],
      ]
      hoverRows.forEach(([r, isActive]) => {
        r.onmouseenter = () => { if (!isActive()) r.style.background = t.bgHover }
        r.onmouseleave = () => { r.style.background = isActive() ? t.bgActive : t.bg }
      })

      // Dark map mini-button visibility and state
      if (isStandard) {
        darkBtn.style.display    = 'flex'
        darkBtn.style.background = darkMap ? t.moonBg : 'transparent'
        darkBtn.style.color      = darkMap ? t.moonColor : (isStandard ? t.textActive : t.textMuted)
        darkBtn.innerHTML        = darkMap ? SVG.sun : SVG.moon
        darkBtn.title            = darkMap ? 'Mapa claro' : 'Mapa oscuro'
      } else {
        darkBtn.style.display = 'none'
      }
    }

    this.unsub = useUIStore.subscribe(sync)
    sync()

    return this.container
  }

  expand() {
    this.expanded = true
    this.panel!.style.width         = '168px'
    this.panel!.style.opacity       = '1'
    this.panel!.style.pointerEvents = 'auto'
    const t = getT(useUIStore.getState().themeMode === 'dark')
    this.toggleBtn!.style.background = t.bgActive
    this.toggleBtn!.style.color      = t.textActive
  }

  collapse() {
    this.expanded = false
    this.panel!.style.width         = '0'
    this.panel!.style.opacity       = '0'
    this.panel!.style.pointerEvents = 'none'
    const t = getT(useUIStore.getState().themeMode === 'dark')
    this.toggleBtn!.style.background = t.bg
    this.toggleBtn!.style.color      = t.text
  }

  onRemove() { this.unsub?.(); this.container?.remove() }
}



// ── FitFleetControl ──────────────────────────────────────────────────────────
class FitFleetControl implements maplibregl.IControl {
  private map?: maplibregl.Map
  private container?: HTMLDivElement
  private unsub?: () => void

  onAdd(map: maplibregl.Map): HTMLElement {
    this.map = map
    this.container = document.createElement('div')
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group armadillo-ctrl'

    const mkBtn = (title: string, svg: string, onClick: () => void) => {
      const btn = document.createElement('button')
      btn.className = 'maplibregl-ctrl-icon armadillo-ctrl-btn'
      btn.title = title
      btn.innerHTML = svg
      btn.addEventListener('click', onClick)
      return btn
    }

    const btnLima = mkBtn('Ver flota Lima',
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>' +
      '<circle cx="12" cy="12" r="3"/></svg>',
      () => {
        if (!this.map) return
        const devices = useVehiclesStore.getState().devices
        const lima = devices.filter(d =>
          d.lat >= -12.55 && d.lat <= -11.75 &&
          d.lng >= -77.35 && d.lng <= -76.70
        )
        const targets = lima.length ? lima : devices
        if (!targets.length) return
        const lngs = targets.map(d => d.lng)
        const lats  = targets.map(d => d.lat)
        targets.length === 1
          ? this.map.flyTo({ center: [lngs[0], lats[0]], zoom: 14 })
          : this.map.fitBounds(
              [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
              { padding: 80, maxZoom: 13 }
            )
      }
    )

    const btnNacional = mkBtn('Ver flota nacional',
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="10"/>' +
      '<line x1="2" y1="12" x2="22" y2="12"/>' +
      '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
      () => {
        if (!this.map) return
        const devices = useVehiclesStore.getState().devices
        if (!devices.length) return
        const lngs = devices.map(d => d.lng)
        const lats  = devices.map(d => d.lat)
        devices.length === 1
          ? this.map.flyTo({ center: [lngs[0], lats[0]], zoom: 12 })
          : this.map.fitBounds(
              [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
              { padding: 80, maxZoom: 12 }
            )
      }
    )

    this.container.appendChild(btnLima)
    this.container.appendChild(btnNacional)

    const apply = () => {
      const t = getT(useUIStore.getState().themeMode === 'dark')
      this.container!.style.cssText = `background:${t.bg};box-shadow:${t.shadow};border:1px solid ${t.border};border-radius:8px;overflow:hidden;`
      ;[btnLima, btnNacional].forEach(b => b.style.color = t.text)
    }
    apply()
    this.unsub = useUIStore.subscribe(apply)
    return this.container
  }
  onRemove() { this.unsub?.(); this.container?.remove(); this.map = undefined }
}

// ── useMap ───────────────────────────────────────────────────────────────────
export function useMap(containerRef: React.RefObject<HTMLDivElement | null>) {
  const setMap   = useMapStore(s => s.setMap)
  const setReady = useMapStore(s => s.setReady)
  const mapRef   = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const { mapStyle, trafficEnabled } = useUIStore.getState()
    const styleUrl = buildStyleUrl(REGION, mapStyle, API_KEY, trafficEnabled)
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl, center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, minZoom: 5,
      attributionControl: {},
    })
    ;(map as any).__styleUrl = styleUrl
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new FitFleetControl(),  'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.addControl(new MapTypeControl(), 'bottom-right')
    mapRef.current = map
    setMap(map)
    map.on('load', () => setReady(true))
    return () => {
      setReady(false)
      useMapStore.getState().clearMap()
      map.remove()
      mapRef.current = null
    }
  }, [containerRef, setMap, setReady])
}
