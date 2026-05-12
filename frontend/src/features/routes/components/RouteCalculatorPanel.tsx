import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Checkbox, TimePicker, Typography } from 'antd'
import {
  CloseOutlined, EnvironmentOutlined, AimOutlined,
  SwapOutlined, SaveOutlined, ArrowRightOutlined,
  LoadingOutlined, RetweetOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useRoutesStore } from '../routesStore'
import { useMapStore } from '../../../store/mapStore'
import type { RouteTravelMode } from '../types'

const BASE = import.meta.env.VITE_API_BASE_URL as string

interface PlaceSuggestion { text: string; placeId: string }
interface ResolvedPlace   { label: string; lng: number; lat: number; point: [number, number] }

async function fetchSuggestions(q: string): Promise<PlaceSuggestion[]> {
  if (q.length < 3) return []
  try {
    const r = await fetch(`${BASE}/api/places/suggest?q=${encodeURIComponent(q)}`)
    if (!r.ok) return []
    return (await r.json()) as PlaceSuggestion[]
  } catch { return [] }
}

async function resolveText(q: string): Promise<ResolvedPlace | null> {
  try {
    const r = await fetch(`${BASE}/api/places/resolve?q=${encodeURIComponent(q)}`)
    if (!r.ok) return null
    return (await r.json()) as ResolvedPlace
  } catch { return null }
}

// ─── PlaceField ───────────────────────────────────────────────────────────────
function PlaceField({
  dotColor, placeholder, value, onChange, onSelect,
  pickActive, onPickStart, onPickCancel, disabled, resolved,
}: {
  dotColor:     string
  placeholder:  string
  value:        string
  onChange:     (v: string) => void
  onSelect:     (p: ResolvedPlace) => void
  pickActive:   boolean
  onPickStart:  () => void
  onPickCancel: () => void
  disabled?:    boolean
  resolved:     boolean
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [open,        setOpen]        = useState(false)
  const [loading,     setLoading]     = useState(false)
  const debounceRef = useRef<number | null>(null)
  const wrapRef     = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLInputElement>(null)

  const handleChange = (v: string) => {
    onChange(v)
    setSuggestions([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (v.length < 3) { setOpen(false); return }
    setLoading(true)
    debounceRef.current = window.setTimeout(async () => {
      const res = await fetchSuggestions(v)
      setSuggestions(res)
      setOpen(res.length > 0)
      setLoading(false)
    }, 400)
  }

  const handleSelect = async (item: PlaceSuggestion) => {
    onChange(item.text)
    setOpen(false)
    setSuggestions([])
    const resolved = await resolveText(item.text)
    if (resolved) onSelect(resolved)
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const borderColor = pickActive
    ? 'var(--color-border-info)'
    : resolved
    ? '#22c55e'
    : 'var(--color-border-secondary)'

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {/* Dot indicador */}
        <div style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          background: resolved ? dotColor : 'var(--color-border-secondary)',
          border: `2px solid ${resolved ? dotColor : 'var(--color-border-secondary)'}`,
          transition: 'all 0.2s',
          boxShadow: resolved ? `0 0 0 3px ${dotColor}22` : 'none',
        }} />

        <div style={{ flex: 1, position: 'relative' }}>
          <input
            ref={inputRef}
            value={value}
            onChange={e => handleChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            style={{
              width: '100%', padding: '8px 32px 8px 10px',
              border: `1.5px solid ${borderColor}`,
              borderRadius: 8, fontSize: 13,
              background: 'var(--color-background-primary)',
              color: 'var(--color-text-primary)',
              outline: 'none', boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
          />
          {/* Icono derecho: loading o pick */}
          <button
            onClick={pickActive ? onPickCancel : onPickStart}
            disabled={disabled}
            title={pickActive ? 'Cancelar selección en mapa' : 'Seleccionar en mapa'}
            style={{
              position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
              width: 26, height: 26, border: 'none', borderRadius: 6,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: pickActive ? 'var(--color-background-info)' : 'transparent',
              color: pickActive ? 'var(--color-text-info)' : 'var(--color-text-tertiary)',
              transition: 'all 0.15s',
            }}
          >
            {loading
              ? <LoadingOutlined style={{ fontSize: 12 }} />
              : <AimOutlined style={{ fontSize: 12 }} />
            }
          </button>
        </div>
      </div>

      {/* Dropdown */}
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 16, right: 0,
          background: 'var(--color-background-primary)',
          border: '1px solid var(--color-border-secondary)',
          borderRadius: 8, zIndex: 1000,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          overflow: 'hidden',
        }}>
          {suggestions.map((s, i) => (
            <div
              key={i}
              onMouseDown={() => handleSelect(s)}
              style={{
                padding: '9px 12px', fontSize: 12.5, cursor: 'pointer',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--color-border-tertiary)' : 'none',
                display: 'flex', alignItems: 'flex-start', gap: 8,
                color: 'var(--color-text-primary)',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-background-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <EnvironmentOutlined style={{ fontSize: 11, color: 'var(--color-text-tertiary)', flexShrink: 0, marginTop: 2 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4 }}>
                {s.text}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Banner de selección en mapa */}
      {pickActive && (
        <div style={{
          marginTop: 6, padding: '5px 10px', borderRadius: 6,
          background: 'var(--color-background-info)',
          border: '1px solid var(--color-border-info)',
          fontSize: 11.5, color: 'var(--color-text-info)',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <AimOutlined style={{ fontSize: 11 }} />
          Haz clic en el mapa para seleccionar este punto
        </div>
      )}
    </div>
  )
}

// ─── Panel principal ──────────────────────────────────────────────────────────
interface Props { open: boolean; onClose: () => void }

export default function RouteCalculatorPanel({ open, onClose }: Props) {
  const map              = useMapStore(s => s.map)
  const loading          = useRoutesStore(s => s.loading)
  const error            = useRoutesStore(s => s.error)
  const previewRoute     = useRoutesStore(s => s.previewRoute)
  const runCalculate     = useRoutesStore(s => s.runCalculate)
  const savePreviewRoute = useRoutesStore(s => s.savePreviewRoute)
  const clearPreview     = useRoutesStore(s => s.clearPreview)

  const [originText,  setOriginText]  = useState('')
  const [destText,    setDestText]    = useState('')
  const [originPoint, setOriginPoint] = useState<[number, number] | null>(null)
  const [destPoint,   setDestPoint]   = useState<[number, number] | null>(null)
  const [avoidTolls,  setAvoidTolls]  = useState(false)
  const [depTime,     setDepTime]     = useState<dayjs.Dayjs | null>(null)
  const [pickMode,    setPickMode]    = useState<'origin' | 'destination' | null>(null)
  const [localError,  setLocalError]  = useState<string | null>(null)
  const [saveId,      setSaveId]      = useState('')
  const [saveStep,    setSaveStep]    = useState(false)
  const [saving,      setSaving]      = useState(false)

  const pickModeRef = useRef<typeof pickMode>(null)
  useEffect(() => { pickModeRef.current = pickMode }, [pickMode])

  // Click en mapa
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
      setPickMode(null)
      clearPreview()
    }
    map.on('click', onClick)
    return () => { map.off('click', onClick) }
  }, [map, open, clearPreview])

  // Cursor
  useEffect(() => {
    if (!map) return
    map.getCanvas().style.cursor = pickMode ? 'crosshair' : ''
    return () => { if (map) map.getCanvas().style.cursor = '' }
  }, [map, pickMode])

  const reset = useCallback(() => {
    setOriginText(''); setOriginPoint(null)
    setDestText('');   setDestPoint(null)
    setAvoidTolls(false); setDepTime(null)
    setLocalError(null); setPickMode(null)
    setSaveId(''); setSaveStep(false)
    clearPreview()
  }, [clearPreview])

  const handleClose = useCallback(() => { reset(); onClose() }, [reset, onClose])

  const handleSwap = () => {
    const tmpText  = originText;  setOriginText(destText);   setDestText(tmpText)
    const tmpPoint = originPoint; setOriginPoint(destPoint); setDestPoint(tmpPoint)
    clearPreview()
  }

  const handleCalculate = async () => {
    setLocalError(null)
    let origin = originPoint
    let dest   = destPoint
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
    const now  = dayjs()
    const dept = depTime ? now.hour(depTime.hour()).minute(depTime.minute()).second(0) : now
    await runCalculate({ origin, destination: dest, travelMode: 'Car' as RouteTravelMode, avoidTolls, departureTime: dept.toISOString() })
  }

  const handleSave = async () => {
    if (!saveId.trim()) return
    setSaving(true)
    await savePreviewRoute(saveId.trim())
    setSaving(false)
    handleClose()
  }

  const formatDist = (d: number | null) =>
    d == null ? '—' : d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`

  const formatDur = (s: number | null) => {
    if (s == null) return '—'
    const m = Math.round(s / 60)
    if (m < 60) return `${m} min`
    const h = Math.floor(m / 60), rm = m % 60
    return rm ? `${h} h ${rm} min` : `${h} h`
  }

  const arrivalTime = (s: number | null) => {
    if (s == null) return null
    const base = depTime ? dayjs().hour(depTime.hour()).minute(depTime.minute()) : dayjs()
    return base.add(s, 'second').format('HH:mm')
  }

  const displayError = localError ?? error
  const collapsed    = !!pickMode
  const canCalculate = !!(originText.trim() && destText.trim())

  if (!open) return null

  return (
    <>
      {/* Panel principal */}
      <div style={{
        position: 'absolute', top: 16, right: 16,
        width: 348,
        background: 'var(--color-background-primary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
        zIndex: 400,
        overflow: 'hidden',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        opacity: collapsed ? 0.08 : 1,
        transform: collapsed ? 'scale(0.98)' : 'scale(1)',
        pointerEvents: collapsed ? 'none' : 'auto',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '13px 16px 12px',
          borderBottom: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-background-secondary)',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'var(--color-background-info)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <SwapOutlined style={{ color: 'var(--color-text-info)', fontSize: 13 }} />
          </div>
          <Typography.Text strong style={{ flex: 1, fontSize: 14 }}>
            Calcular ruta
          </Typography.Text>
          {previewRoute && (
            <button
              onClick={reset}
              title="Limpiar"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--color-text-tertiary)', padding: '4px 8px',
                borderRadius: 6, fontSize: 11,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <RetweetOutlined style={{ fontSize: 11 }} /> Limpiar
            </button>
          )}
          <button
            onClick={handleClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', padding: 4, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        </div>

        <div style={{ padding: '14px 16px' }}>

          {/* Error */}
          {displayError && (
            <div style={{
              padding: '8px 12px', marginBottom: 12, borderRadius: 8,
              background: 'var(--color-background-danger)',
              border: '1px solid var(--color-border-danger)',
              fontSize: 12, color: 'var(--color-text-danger)', lineHeight: 1.5,
            }}>
              {displayError}
            </div>
          )}

          {/* Campos de origen y destino con swap */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginBottom: 12 }}>
            {/* Línea conectora + campos */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Origen */}
              <PlaceField
                dotColor="#00418b"
                placeholder="Origen"
                value={originText}
                onChange={v => { setOriginText(v); setOriginPoint(null); clearPreview() }}
                onSelect={r => { setOriginPoint(r.point); setOriginText(r.label) }}
                pickActive={pickMode === 'origin'}
                onPickStart={() => setPickMode('origin')}
                onPickCancel={() => setPickMode(null)}
                resolved={!!originPoint}
              />

              {/* Separador visual */}
              <div style={{
                height: 1, background: 'var(--color-border-tertiary)',
                marginLeft: 16,
              }} />

              {/* Destino */}
              <PlaceField
                dotColor="#f97316"
                placeholder="Destino"
                value={destText}
                onChange={v => { setDestText(v); setDestPoint(null); clearPreview() }}
                onSelect={r => { setDestPoint(r.point); setDestText(r.label) }}
                pickActive={pickMode === 'destination'}
                onPickStart={() => setPickMode('destination')}
                onPickCancel={() => setPickMode(null)}
                resolved={!!destPoint}
              />
            </div>

            {/* Botón swap vertical */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={handleSwap}
                disabled={!originText && !destText}
                title="Intercambiar origen y destino"
                style={{
                  width: 30, height: 30, border: '1px solid var(--color-border-secondary)',
                  borderRadius: 8, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--color-background-primary)',
                  color: 'var(--color-text-secondary)',
                  opacity: (!originText && !destText) ? 0.4 : 1,
                  transition: 'all 0.15s',
                }}
              >
                <SwapOutlined style={{ fontSize: 12, transform: 'rotate(90deg)' }} />
              </button>
            </div>
          </div>

          {/* Opciones en una fila compacta */}
          <div style={{
            display: 'flex', gap: 10, alignItems: 'center',
            padding: '8px 10px', borderRadius: 8, marginBottom: 12,
            background: 'var(--color-background-secondary)',
            border: '0.5px solid var(--color-border-tertiary)',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Salida
              </div>
              <TimePicker
                format="HH:mm" minuteStep={30} placeholder="Ahora"
                value={depTime} onChange={v => { setDepTime(v); clearPreview() }}
                style={{ width: '100%', height: 28 }}
                use12Hours={false} showNow={false}
                size="small"
              />
            </div>
            <div style={{ width: 1, height: 32, background: 'var(--color-border-tertiary)' }} />
            <Checkbox
              checked={avoidTolls}
              onChange={e => { setAvoidTolls(e.target.checked); clearPreview() }}
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            >
              Sin peajes
            </Checkbox>
          </div>

          {/* Resultado */}
          {previewRoute && !saveStep && (
            <div style={{
              marginBottom: 12, borderRadius: 10,
              background: 'linear-gradient(135deg, var(--color-background-info) 0%, var(--color-background-secondary) 100%)',
              border: '1px solid var(--color-border-info)',
              overflow: 'hidden',
            }}>
              {/* Métricas principales */}
              <div style={{ padding: '12px 14px 10px', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1 }}>
                    {formatDist(previewRoute.distance)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>distancia</div>
                </div>
                <div style={{ width: 1, height: 32, background: 'var(--color-border-info)', opacity: 0.4 }} />
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1 }}>
                    {formatDur(previewRoute.durationSeconds)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>duración</div>
                </div>
              </div>
              {/* Horario */}
              <div style={{
                padding: '8px 14px', borderTop: '1px solid var(--color-border-info)',
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: 'var(--color-text-secondary)',
                background: 'rgba(0,0,0,0.03)',
              }}>
                <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  {dayjs(previewRoute.departureTime).format('HH:mm')}
                </span>
                <ArrowRightOutlined style={{ fontSize: 9, opacity: 0.6 }} />
                <span style={{ fontWeight: 600, color: 'var(--color-text-info)' }}>
                  {arrivalTime(previewRoute.durationSeconds)}
                </span>
                <span style={{ marginLeft: 2, fontSize: 11, opacity: 0.6 }}>llegada estimada</span>
              </div>
            </div>
          )}

          {/* Paso guardar */}
          {saveStep && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Nombre de la ruta
              </div>
              <input
                value={saveId}
                onChange={e => setSaveId(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                placeholder="ej. ruta-callao-miraflores"
                autoFocus
                style={{
                  width: '100%', padding: '8px 10px',
                  border: '1.5px solid var(--color-border-info)',
                  borderRadius: 8, fontSize: 13,
                  background: 'var(--color-background-primary)',
                  color: 'var(--color-text-primary)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                Letras, números, guiones y guiones bajos
              </div>
            </div>
          )}

          {/* Acciones */}
          <div style={{ display: 'flex', gap: 8 }}>
            {!saveStep ? (
              <>
                <Button
                  onClick={handleCalculate}
                  loading={loading}
                  disabled={!canCalculate}
                  type={previewRoute ? 'default' : 'primary'}
                  style={{ flex: previewRoute ? 1 : undefined, width: previewRoute ? undefined : '100%' }}
                  icon={<SwapOutlined />}
                >
                  {previewRoute ? 'Recalcular' : 'Calcular ruta'}
                </Button>
                {previewRoute && (
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={() => setSaveStep(true)}
                    style={{ flex: 1 }}
                  >
                    Guardar ruta
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button onClick={() => setSaveStep(false)} style={{ flex: 1 }}>
                  Atrás
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  disabled={!saveId.trim()}
                  onClick={handleSave}
                  style={{ flex: 1 }}
                >
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
          background: 'var(--color-background-primary)',
          border: '1.5px solid var(--color-border-info)',
          borderRadius: 32, padding: '10px 18px', zIndex: 400,
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          fontSize: 13, color: 'var(--color-text-primary)',
          animation: 'fadeInUp 0.2s ease',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--color-background-info)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <AimOutlined style={{ color: 'var(--color-text-info)', fontSize: 13 }} />
          </div>
          <span>
            Selecciona el{' '}
            <strong style={{ color: pickMode === 'origin' ? '#00418b' : '#f97316' }}>
              {pickMode === 'origin' ? 'origen' : 'destino'}
            </strong>
            {' '}en el mapa
          </span>
          <button
            onClick={() => setPickMode(null)}
            style={{
              background: 'var(--color-background-secondary)',
              border: '1px solid var(--color-border-secondary)',
              cursor: 'pointer', color: 'var(--color-text-secondary)',
              padding: '3px 8px', borderRadius: 6, fontSize: 11,
            }}
          >
            Cancelar
          </button>
        </div>
      )}
    </>
  )
}
