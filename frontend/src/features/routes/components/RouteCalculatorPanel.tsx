import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Typography, theme } from 'antd'
import {
  CloseOutlined, CloseCircleOutlined, EnvironmentOutlined, AimOutlined, HistoryOutlined, DeleteOutlined,
  SwapOutlined, SaveOutlined, LoadingOutlined, RetweetOutlined,
} from '@ant-design/icons'
import { useRoutesStore } from '../routesStore'
import { useMapStore } from '../../../store/mapStore'
import { useUIStore } from '../../../store/uiStore'
import { resolvePlaceId } from '../routesService'
import type { RouteTravelMode } from '../types'
import type { TrafficSpan } from '../routesService'

const BASE = import.meta.env.VITE_API_BASE_URL as string

const SIDEBAR_EXPANDED  = 280
const SIDEBAR_COLLAPSED = 56

interface PlaceSuggestion { text: string; placeId: string; position?: [number, number] }
interface ResolvedPlace   { label: string; lng: number; lat: number; point: [number, number] }

async function fetchSuggestions(q: string): Promise<PlaceSuggestion[]> {
  if (q.length < 2) return []
  try {
    const r = await fetch(`${BASE}/api/places/suggest?q=${encodeURIComponent(q)}`)
    if (!r.ok) return []
    return await r.json()
  } catch { return [] }
}

async function resolveText(q: string): Promise<ResolvedPlace | null> {
  try {
    const r = await fetch(`${BASE}/api/places/resolve?q=${encodeURIComponent(q)}`)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

const fmtDist = (d: number | null) => {
  if (d == null) return '—'
  if (d < 1) return `${Math.round(d * 1000)} m`
  return `${d % 1 === 0 ? d : d.toFixed(1)} km`
}

const fmtDur = (s: number | null) => {
  if (s == null) return '—'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), rm = m % 60
  return rm ? `${h} h ${rm} min` : `${h} h`
}

const arrivalStr = (durationSeconds: number | null) => {
  if (durationSeconds == null) return null
  return new Date(Date.now() + durationSeconds * 1000)
    .toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false })
}

const hasTrafficDelay = (spans?: TrafficSpan[]) =>
  !!spans?.some(s => s.congestion > 0.3)


const HISTORY_KEY = 'armadillo_place_history'
const MAX_HISTORY = 5

function loadHistory(): PlaceSuggestion[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') }
  catch { return [] }
}

function saveToHistory(item: PlaceSuggestion) {
  const prev = loadHistory().filter(h => h.text !== item.text)
  localStorage.setItem(HISTORY_KEY, JSON.stringify([item, ...prev].slice(0, MAX_HISTORY)))
}

function removeFromHistory(text: string) {
  const prev = loadHistory().filter(h => h.text !== text)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(prev))
}

// ─── PlaceField ───────────────────────────────────────────────────────────────
function PlaceField({
  dotColor, placeholder, value, onChange, onSelect,
  pickActive, onPickStart, onPickCancel, disabled, resolved,
}: {
  dotColor: string; placeholder: string; value: string
  onChange: (v: string) => void; onSelect: (p: ResolvedPlace) => void
  pickActive: boolean; onPickStart: () => void; onPickCancel: () => void
  disabled?: boolean; resolved: boolean
}) {
  const { token } = theme.useToken()
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [open,        setOpen]        = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [history,     setHistory]     = useState<PlaceSuggestion[]>(() => loadHistory())
  const debounceRef = useRef<number | null>(null)
  const wrapRef     = useRef<HTMLDivElement>(null)

  const handleChange = (v: string) => {
    onChange(v); setSuggestions([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (v.length < 2) { setOpen(false); return }
    setLoading(true)
    debounceRef.current = window.setTimeout(async () => {
      const res = await fetchSuggestions(v)
      setSuggestions(res); setOpen(res.length > 0); setLoading(false)
    }, 350)
  }

  const handleSelect = async (item: PlaceSuggestion) => {
    onChange(item.text); setOpen(false); setSuggestions([])
    saveToHistory(item); setHistory(loadHistory())
    // Si la sugerencia ya trae coordenadas (desde SearchText), usarlas directamente
    if (item.position) {
      const [lng, lat] = item.position
      onSelect({ label: item.text, lng, lat, point: item.position })
      return
    }
    // Fallback: resolver por placeId o texto
    let resolved: ResolvedPlace | null = null
    if (item.placeId) {
      const r = await resolvePlaceId(item.placeId)
      if (r) resolved = { label: r.label, lng: r.point[0], lat: r.point[1], point: r.point }
    }
    if (!resolved) resolved = await resolveText(item.text)
    if (resolved) { onChange(resolved.label); onSelect(resolved) }
  }

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const borderColor = pickActive ? token.colorPrimary
    : resolved ? '#34a853' : token.colorBorder

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{
          width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
          background: resolved ? dotColor : token.colorBorderSecondary,
          boxShadow: resolved ? `0 0 0 3px ${dotColor}30` : 'none',
          transition: 'all 0.2s',
        }} />
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            value={value} onChange={e => handleChange(e.target.value)}
            onFocus={() => { if (suggestions.length > 0) setOpen(true); else if (!value && history.length > 0) setOpen(true) }}
            placeholder={placeholder} disabled={disabled}
            style={{
              width: '100%', padding: '8px 60px 8px 10px',
              border: `1.5px solid ${borderColor}`, borderRadius: token.borderRadius,
              fontSize: 13, background: token.colorBgContainer,
              color: token.colorText, outline: 'none',
              boxSizing: 'border-box', transition: 'border-color 0.15s',
            }}
          />
          {value && !pickActive && (
            <button
              onClick={() => { onChange(''); setSuggestions([]); setOpen(false) }}
              title="Limpiar"
              style={{
                position: 'absolute', right: 31, top: '50%', transform: 'translateY(-50%)',
                width: 22, height: 22, border: 'none', borderRadius: 4, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', color: token.colorTextTertiary,
              }}>
              <CloseCircleOutlined style={{ fontSize: 11 }} />
            </button>
          )}
          <button onClick={pickActive ? onPickCancel : onPickStart} disabled={disabled}
            title={pickActive ? 'Cancelar' : 'Seleccionar en mapa'}
            style={{
              position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)',
              width: 26, height: 26, border: 'none', borderRadius: 6, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: pickActive ? `${token.colorPrimary}18` : 'transparent',
              color: pickActive ? token.colorPrimary : token.colorTextTertiary,
            }}>
            {loading
              ? <LoadingOutlined style={{ fontSize: 12 }} />
              : <AimOutlined    style={{ fontSize: 12 }} />}
          </button>
        </div>
      </div>

      {/* Dropdown de sugerencias */}
      {open && (suggestions.length > 0 || (!value && history.length > 0)) && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 15, right: 0,
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadius,
          zIndex: 1200,
          boxShadow: token.boxShadowSecondary,
          overflow: 'hidden',
        }}>
          {/* Header cuando es historial */}
          {!value && suggestions.length === 0 && history.length > 0 && (
            <div style={{ padding: '6px 12px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-tertiary, #8c8c8c)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4 }}>
                <HistoryOutlined style={{ fontSize: 10 }} /> Recientes
              </span>
            </div>
          )}
          {(suggestions.length > 0 ? suggestions : (!value ? history : [])).map((s, i) => (
            <div key={i} onMouseDown={() => handleSelect(s)}
              style={{
                padding: '9px 12px', fontSize: 13, cursor: 'pointer',
                borderBottom: i < suggestions.length - 1
                  ? `1px solid ${token.colorBorderSecondary}` : 'none',
                display: 'flex', alignItems: 'flex-start', gap: 8,
                color: token.colorText, transition: 'background 0.1s',
                // texto completo — sin truncar en el dropdown
                whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.4,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = token.colorBgTextHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {suggestions.length === 0 && !value
                ? <HistoryOutlined style={{ fontSize: 11, color: token.colorTextTertiary, flexShrink: 0, marginTop: 2 }} />
                : <EnvironmentOutlined style={{ fontSize: 12, color: '#ea4335', flexShrink: 0, marginTop: 2 }} />
              }
              <span style={{ flex: 1 }}>{s.text}</span>
              {suggestions.length === 0 && !value && (
                <button
                  onMouseDown={e => {
                    e.stopPropagation()
                    setHistory(loadHistory())
                    if (loadHistory().length === 0) setOpen(false)
                  }}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px', color: token.colorTextTertiary, flexShrink: 0 }}
                  title="Eliminar del historial"
                >
                  <DeleteOutlined style={{ fontSize: 10 }} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {pickActive && (
        <div style={{
          marginTop: 5, padding: '5px 10px', borderRadius: 6,
          background: `${token.colorPrimary}14`,
          border: `1px solid ${token.colorPrimary}`,
          fontSize: 11.5, color: token.colorPrimary,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <AimOutlined style={{ fontSize: 10 }} /> Haz clic en el mapa para seleccionar este punto
        </div>
      )}
    </div>
  )
}

// ─── Tarjeta de alternativa ───────────────────────────────────────────────────
function AltCard({
  index, distance, durationSeconds, trafficSpans, selected, onSelect,
}: {
  index: number; distance: number | null; durationSeconds: number | null
  trafficSpans?: TrafficSpan[]; selected: boolean; onSelect: () => void
}) {
  const { token } = theme.useToken()
  const label  = index === 0 ? 'Más rápida' : `Alt. ${index}`
  const colors = [token.colorPrimary, token.colorTextSecondary, token.colorTextTertiary]
  const color  = colors[index] ?? colors[colors.length - 1]
  const hasDelay = hasTrafficDelay(trafficSpans)

  return (
    <button onClick={onSelect} style={{
      flex: 1, minWidth: 0, padding: '8px 8px 7px', borderRadius: token.borderRadius,
      cursor: 'pointer', textAlign: 'left', outline: 'none',
      border: selected ? `2px solid ${color}` : `1.5px solid ${token.colorBorderSecondary}`,
      background: selected ? `${color}14` : token.colorBgLayout,
      transition: 'all 0.12s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 5 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: selected ? color : token.colorTextTertiary,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>{label}</span>
        {hasDelay && (
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f44336', flexShrink: 0 }} />
        )}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: token.colorText, lineHeight: 1 }}>
        {fmtDur(durationSeconds)}
      </div>
      <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 3 }}>
        {fmtDist(distance)}
      </div>
    </button>
  )
}

// ─── Panel principal ──────────────────────────────────────────────────────────
interface Props { open: boolean; onClose: () => void }

export default function RouteCalculatorPanel({ open, onClose }: Props) {
  const { token } = theme.useToken()
  const map              = useMapStore(s => s.map)
  const sidebarCollapsed = useUIStore(s => s.sidebarCollapsed)
  const loading          = useRoutesStore(s => s.loading)
  const error            = useRoutesStore(s => s.error)
  const previewRoute     = useRoutesStore(s => s.previewRoute)
  const runCalculate     = useRoutesStore(s => s.runCalculate)
  const savePreviewRoute = useRoutesStore(s => s.savePreviewRoute)
  const clearPreview     = useRoutesStore(s => s.clearPreview)
  const selectedAltIndex = useRoutesStore(s => s.selectedAltIndex)
  const selectAltIndex   = useRoutesStore(s => s.selectAltIndex)

  const [originText,  setOriginText]  = useState('')
  const [destText,    setDestText]    = useState('')
  const [originPoint, setOriginPoint] = useState<[number, number] | null>(null)
  const [destPoint,   setDestPoint]   = useState<[number, number] | null>(null)
  const [avoidTolls,  setAvoidTolls]  = useState(false)
  const [pickMode,    setPickMode]    = useState<'origin' | 'destination' | null>(null)
  const [localError,  setLocalError]  = useState<string | null>(null)
  const [saveId,      setSaveId]      = useState('')
  const [saveStep,    setSaveStep]    = useState(false)
  const [saving,      setSaving]      = useState(false)

  const pickModeRef = useRef<typeof pickMode>(null)
  useEffect(() => { pickModeRef.current = pickMode }, [pickMode])

  const leftOffset = (sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED) + 12

  useEffect(() => {
    if (!map || !open) return
    const onClick = async (e: any) => {
      const mode = pickModeRef.current
      if (!mode) return
      const { lat, lng } = e.lngLat
      const resolved = await resolveText(`${lat},${lng}`)
      const label    = resolved?.label ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
      const point: [number, number] = [lng, lat]
      if (mode === 'origin') { setOriginText(label); setOriginPoint(point) }
      else                   { setDestText(label);   setDestPoint(point) }
      setPickMode(null); clearPreview()
    }
    map.on('click', onClick)
    return () => { map.off('click', onClick) }
  }, [map, open, clearPreview])

  useEffect(() => {
    if (!map) return
    map.getCanvas().style.cursor = pickMode ? 'crosshair' : ''
    return () => { if (map) map.getCanvas().style.cursor = '' }
  }, [map, pickMode])

  const reset = useCallback(() => {
    setOriginText(''); setOriginPoint(null)
    setDestText('');   setDestPoint(null)
    setAvoidTolls(false); setLocalError(null); setPickMode(null)
    setSaveId(''); setSaveStep(false); clearPreview()
  }, [clearPreview])

  const handleClose = useCallback(() => { reset(); onClose() }, [reset, onClose])

  const handleSwap = () => {
    const t = originText; setOriginText(destText); setDestText(t)
    const p = originPoint; setOriginPoint(destPoint); setDestPoint(p)
    clearPreview()
  }

  const handleCalculate = async () => {
    setLocalError(null)
    let origin = originPoint, dest = destPoint
    if (!origin && !originText.trim()) { setLocalError('Ingresa el origen'); return }
    if (!dest   && !destText.trim())   { setLocalError('Ingresa el destino'); return }
    if (!origin) {
      const r = await resolveText(originText)
      if (!r) { setLocalError('No se encontró el origen'); return }
      origin = r.point; setOriginPoint(r.point); setOriginText(r.label)
    }
    if (!dest) {
      const r = await resolveText(destText)
      if (!r) { setLocalError('No se encontró el destino'); return }
      dest = r.point; setDestPoint(r.point); setDestText(r.label)
    }
    await runCalculate({ origin, destination: dest, travelMode: 'Car' as RouteTravelMode, avoidTolls })
  }

  const handleSave = async () => {
    if (!saveId.trim()) return
    setSaving(true); await savePreviewRoute(saveId.trim()); setSaving(false); handleClose()
  }

  const displayError = localError ?? error
  const collapsed    = !!pickMode
  const canCalculate = !!(originText.trim() && destText.trim())
  const allAlts      = previewRoute ? [previewRoute, ...(previewRoute.alternatives ?? [])] : []
  const activeAlt    = allAlts[selectedAltIndex] ?? null

  if (!open) return null

  return (
    <>
      {/* Panel principal — sólido, respeta dark/light mode */}
      <div style={{
        position: 'absolute',
        top: 12,
        left: leftOffset,
        width: 306,
        // Token correcto de Ant Design — sólido en ambos modos
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadow,
        zIndex: 400,
        overflow: 'hidden',
        // Sin transparencia: se oculta completamente al seleccionar en mapa
        visibility: collapsed ? 'hidden' : 'visible',
        transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '11px 12px 10px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgLayout,
        }}>
          <SwapOutlined style={{ color: token.colorPrimary, fontSize: 14 }} />
          <Typography.Text strong style={{ flex: 1, fontSize: 13 }}>Calcular ruta</Typography.Text>
          {previewRoute && (
            <button onClick={reset} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: token.colorTextTertiary, padding: '3px 6px', borderRadius: 6, fontSize: 11,
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <RetweetOutlined style={{ fontSize: 10 }} /> Limpiar
            </button>
          )}
          <button onClick={handleClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: token.colorTextTertiary, padding: 3, borderRadius: 6,
            display: 'flex', alignItems: 'center',
          }}>
            <CloseOutlined style={{ fontSize: 11 }} />
          </button>
        </div>

        <div style={{ padding: '12px 12px 14px' }}>

          {displayError && (
            <div style={{
              padding: '7px 10px', marginBottom: 10, borderRadius: token.borderRadius,
              background: `${token.colorError}14`, border: `1px solid ${token.colorError}40`,
              fontSize: 12, color: token.colorError, lineHeight: 1.5,
            }}>{displayError}</div>
          )}

          {/* Origen / Destino */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginBottom: 10 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <PlaceField dotColor={token.colorPrimary} placeholder="Origen" value={originText}
                onChange={v => { setOriginText(v); setOriginPoint(null); clearPreview() }}
                onSelect={r => { setOriginPoint(r.point); setOriginText(r.label) }}
                pickActive={pickMode === 'origin'} onPickStart={() => setPickMode('origin')}
                onPickCancel={() => setPickMode(null)} resolved={!!originPoint} />
              <div style={{ height: 1, background: token.colorBorderSecondary, marginLeft: 15 }} />
              <PlaceField dotColor="#ea4335" placeholder="Destino" value={destText}
                onChange={v => { setDestText(v); setDestPoint(null); clearPreview() }}
                onSelect={r => { setDestPoint(r.point); setDestText(r.label) }}
                pickActive={pickMode === 'destination'} onPickStart={() => setPickMode('destination')}
                onPickCancel={() => setPickMode(null)} resolved={!!destPoint} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button onClick={handleSwap} disabled={!originText && !destText}
                style={{
                  width: 28, height: 28, border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadius, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: token.colorBgContainer, color: token.colorTextSecondary,
                  opacity: (!originText && !destText) ? 0.4 : 1,
                }}>
                <SwapOutlined style={{ fontSize: 11, transform: 'rotate(90deg)' }} />
              </button>
            </div>
          </div>

          {/* Sin peajes */}
          <div style={{ marginBottom: 10 }}>
            <Checkbox checked={avoidTolls} onChange={e => { setAvoidTolls(e.target.checked); clearPreview() }}
              style={{ fontSize: 12 }}>Evitar peajes</Checkbox>
          </div>

          {/* Alternativas */}
          {previewRoute && !saveStep && allAlts.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {allAlts.map((alt, i) => (
                  <AltCard key={i} index={i}
                    distance={alt.distance} durationSeconds={alt.durationSeconds}
                    trafficSpans={(alt as any).trafficSpans}
                    selected={selectedAltIndex === i} onSelect={() => selectAltIndex(i)} />
                ))}
              </div>

              {activeAlt && (
                <div style={{
                  borderRadius: token.borderRadius, padding: '10px 12px',
                  background: token.colorBgLayout,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 26, fontWeight: 700, color: token.colorText, lineHeight: 1 }}>
                        {fmtDur(activeAlt.durationSeconds)}
                      </div>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 2 }}>
                        {fmtDist(activeAlt.distance)}
                      </div>
                    </div>
                    <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 2 }}>Llegada</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: token.colorPrimary }}>
                        {arrivalStr(activeAlt.durationSeconds)}
                      </div>
                    </div>
                  </div>

                  {hasTrafficDelay((activeAlt as any).trafficSpans) && (
                    <div style={{
                      marginTop: 8, padding: '5px 8px', borderRadius: 6,
                      background: '#fff3e0', border: '1px solid #ffcc02',
                      fontSize: 11, color: '#e65100',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f44336', flexShrink: 0 }} />
                      Hay tráfico en esta ruta
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Paso guardar */}
          {saveStep && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: token.colorTextSecondary, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Nombre de la ruta
              </div>
              <input value={saveId} onChange={e => setSaveId(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                placeholder="ej. ruta-callao-miraflores" autoFocus
                style={{
                  width: '100%', padding: '8px 10px',
                  border: `1.5px solid ${token.colorPrimary}`,
                  borderRadius: token.borderRadius, fontSize: 13,
                  background: token.colorBgContainer, color: token.colorText,
                  outline: 'none', boxSizing: 'border-box',
                }} />
            </div>
          )}

          {/* Acciones */}
          <div style={{ display: 'flex', gap: 8 }}>
            {!saveStep ? (
              <>
                <Button onClick={handleCalculate} loading={loading} disabled={!canCalculate}
                  type={previewRoute ? 'default' : 'primary'}
                  style={{ flex: previewRoute ? 1 : undefined, width: previewRoute ? undefined : '100%' }}
                  icon={<SwapOutlined />}>
                  {previewRoute ? 'Recalcular' : 'Calcular ruta'}
                </Button>
                {previewRoute && (
                  <Button type="primary" icon={<SaveOutlined />} onClick={() => setSaveStep(true)} style={{ flex: 1 }}>
                    Guardar ruta
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button onClick={() => setSaveStep(false)} style={{ flex: 1 }}>Atrás</Button>
                <Button type="primary" icon={<SaveOutlined />} loading={saving}
                  disabled={!saveId.trim()} onClick={handleSave} style={{ flex: 1 }}>
                  Confirmar
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Pill flotante al seleccionar en mapa */}
      {collapsed && (
        <div style={{
          position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)',
          background: token.colorBgContainer,
          border: `2px solid ${token.colorPrimary}`,
          borderRadius: 32, padding: '10px 20px', zIndex: 400,
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: token.boxShadow, fontSize: 13, color: token.colorText,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: `${token.colorPrimary}18`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <AimOutlined style={{ color: token.colorPrimary, fontSize: 13 }} />
          </div>
          <span>
            Selecciona el{' '}
            <strong style={{ color: pickMode === 'origin' ? token.colorPrimary : '#ea4335' }}>
              {pickMode === 'origin' ? 'origen' : 'destino'}
            </strong>
            {' '}en el mapa
          </span>
          <button onClick={() => setPickMode(null)} style={{
            background: token.colorBgLayout, border: `1px solid ${token.colorBorderSecondary}`,
            cursor: 'pointer', color: token.colorTextSecondary,
            padding: '4px 10px', borderRadius: 6, fontSize: 11,
          }}>Cancelar</button>
        </div>
      )}
    </>
  )
}
