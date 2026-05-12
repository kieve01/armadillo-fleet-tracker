import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Checkbox, TimePicker, Typography } from 'antd'
import {
  CloseOutlined, SearchOutlined, AimOutlined,
  SwapOutlined, SaveOutlined, ArrowRightOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useRoutesStore } from '../routesStore'
import { useMapStore } from '../../../store/mapStore'
import type { RouteTravelMode } from '../types'

const BASE = import.meta.env.VITE_API_BASE_URL as string

interface PlaceSuggestion { text: string; placeId: string }
interface ResolvedPlace   { label: string; lng: number; lat: number; point: [number, number] }

// ─── API helpers ─────────────────────────────────────────────────────────────
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

// ─── PlaceField — input con dropdown propio ───────────────────────────────────
function PlaceField({
  label, placeholder, value, onChange, onSelect,
  pickActive, onPickStart, onPickCancel, disabled,
}: {
  label:        string
  placeholder:  string
  value:        string
  onChange:     (v: string) => void
  onSelect:     (p: ResolvedPlace) => void
  pickActive:   boolean
  onPickStart:  () => void
  onPickCancel: () => void
  disabled?:    boolean
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [open,        setOpen]        = useState(false)
  const [loading,     setLoading]     = useState(false)
  const debounceRef = useRef<number | null>(null)
  const wrapRef     = useRef<HTMLDivElement>(null)

  // Debounce de búsqueda
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

  // Cerrar al click fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={wrapRef} style={{ marginBottom: 12, position: 'relative' }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <SearchOutlined style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--color-text-tertiary)', fontSize: 13, pointerEvents: 'none',
          }} />
          <input
            value={value}
            onChange={e => handleChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            style={{
              width: '100%', padding: '7px 10px 7px 30px',
              border: `1px solid ${pickActive ? 'var(--color-border-info)' : 'var(--color-border-secondary)'}`,
              borderRadius: 8, fontSize: 13,
              background: 'var(--color-background-primary)',
              color: 'var(--color-text-primary)',
              outline: 'none', boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
          />
          {loading && (
            <span style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 11, color: 'var(--color-text-tertiary)',
            }}>
              Buscando...
            </span>
          )}
        </div>
        <button
          onClick={pickActive ? onPickCancel : onPickStart}
          title={pickActive ? 'Cancelar selección' : 'Elegir en el mapa'}
          disabled={disabled}
          style={{
            width: 34, height: 34, flexShrink: 0,
            border: `1px solid ${pickActive ? 'var(--color-border-info)' : 'var(--color-border-secondary)'}`,
            borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: pickActive ? 'var(--color-background-info)' : 'var(--color-background-primary)',
            color: pickActive ? 'var(--color-text-info)' : 'var(--color-text-secondary)',
            transition: 'all 0.15s',
          }}
        >
          <AimOutlined style={{ fontSize: 14 }} />
        </button>
      </div>

      {/* Dropdown de sugerencias */}
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 40,
          background: 'var(--color-background-primary)',
          border: '1px solid var(--color-border-secondary)',
          borderRadius: 8, zIndex: 1000, marginTop: 4,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          overflow: 'hidden',
        }}>
          {suggestions.map((s, i) => (
            <div
              key={i}
              onMouseDown={() => handleSelect(s)}
              style={{
                padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--color-border-tertiary)' : 'none',
                display: 'flex', alignItems: 'center', gap: 8,
                color: 'var(--color-text-primary)',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-background-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <AimOutlined style={{ fontSize: 12, color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.text}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Indicador de selección en mapa */}
      {pickActive && (
        <div style={{
          marginTop: 6, padding: '6px 10px', borderRadius: 6,
          background: 'var(--color-background-info)',
          border: '1px solid var(--color-border-info)',
          fontSize: 12, color: 'var(--color-text-info)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <AimOutlined style={{ fontSize: 12 }} />
          Haz clic en el mapa para seleccionar {label.toLowerCase()}
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

  const [originText,   setOriginText]   = useState('')
  const [destText,     setDestText]     = useState('')
  const [originPoint,  setOriginPoint]  = useState<[number, number] | null>(null)
  const [destPoint,    setDestPoint]    = useState<[number, number] | null>(null)
  const [avoidTolls,   setAvoidTolls]   = useState(false)
  const [depTime,      setDepTime]      = useState<dayjs.Dayjs | null>(null)
  const [pickMode,     setPickMode]     = useState<'origin' | 'destination' | null>(null)
  const [localError,   setLocalError]   = useState<string | null>(null)
  const [saveId,       setSaveId]       = useState('')
  const [saveStep,     setSaveStep]     = useState(false)
  const [saving,       setSaving]       = useState(false)

  const pickModeRef = useRef<typeof pickMode>(null)
  useEffect(() => { pickModeRef.current = pickMode }, [pickMode])

  // ── Click en mapa ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !open) return
    const onClick = async (e: any) => {
      const mode = pickModeRef.current
      if (!mode) return
      const { lat, lng } = e.lngLat
      const resolved = await resolveText(`${lat},${lng}`)
      const label    = resolved?.label ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
      const point: [number, number] = [lng, lat]
      if (mode === 'origin') {
        setOriginText(label); setOriginPoint(point)
      } else {
        setDestText(label); setDestPoint(point)
      }
      setPickMode(null)
      clearPreview()
    }
    map.on('click', onClick)
    return () => { map.off('click', onClick) }
  }, [map, open, clearPreview])

  // Cursor del mapa
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

  const handleClose = useCallback(() => {
    reset(); onClose()
  }, [reset, onClose])

  const handleCalculate = async () => {
    setLocalError(null)
    let origin = originPoint
    let dest   = destPoint

    if (!origin && !originText.trim()) { setLocalError('Ingresa el origen'); return }
    if (!dest   && !destText.trim())   { setLocalError('Ingresa el destino'); return }

    if (!origin) {
      const r = await resolveText(originText)
      if (!r) { setLocalError('No se encontró el origen. Intenta con otra descripción.'); return }
      origin = r.point; setOriginPoint(r.point); setOriginText(r.label)
    }
    if (!dest) {
      const r = await resolveText(destText)
      if (!r) { setLocalError('No se encontró el destino. Intenta con otra descripción.'); return }
      dest = r.point; setDestPoint(r.point); setDestText(r.label)
    }

    const now  = dayjs()
    const dept = depTime
      ? now.hour(depTime.hour()).minute(depTime.minute()).second(0)
      : now

    await runCalculate({
      origin, destination: dest,
      travelMode: 'Car' as RouteTravelMode,
      avoidTolls,
      departureTime: dept.toISOString(),
    })
  }

  const handleSave = async () => {
    if (!saveId.trim()) return
    setSaving(true)
    await savePreviewRoute(saveId.trim())
    setSaving(false)
    handleClose()
  }

  const formatDist = (d: number | null) =>
    d == null ? '-' : d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`

  const formatDur = (s: number | null) => {
    if (s == null) return '-'
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

  // El panel se oculta pero NO se desmonta cuando pickMode está activo
  // (permite interactuar con el mapa sin perder el estado)
  const collapsed = !!pickMode

  if (!open) return null

  return (
    <>
      {/* Panel flotante sobre el mapa */}
      <div style={{
        position:     'absolute',
        top:          16,
        right:        16,
        width:        340,
        background:   'var(--color-background-primary)',
        border:       '0.5px solid var(--color-border-secondary)',
        borderRadius: 12,
        boxShadow:    '0 4px 24px rgba(0,0,0,0.12)',
        zIndex:       400,
        overflow:     'hidden',
        transition:   'transform 0.25s ease, opacity 0.2s ease',
        // Cuando está en modo pick, el panel sube y se hace más pequeño
        transform:    collapsed ? 'translateY(-8px) scale(0.97)' : 'translateY(0) scale(1)',
        opacity:      collapsed ? 0.15 : 1,
        pointerEvents: collapsed ? 'none' : 'auto',
      }}>
        {/* Header */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          gap:            10,
          padding:        '12px 16px',
          borderBottom:   '0.5px solid var(--color-border-tertiary)',
        }}>
          <SwapOutlined style={{ color: 'var(--color-text-info)', fontSize: 15 }} />
          <Typography.Text strong style={{ flex: 1, fontSize: 14 }}>
            Calcular ruta
          </Typography.Text>
          <button
            onClick={handleClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', padding: 4, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <CloseOutlined style={{ fontSize: 13 }} />
          </button>
        </div>

        {/* Cuerpo */}
        <div style={{ padding: '14px 16px' }}>

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

          <PlaceField
            label="A" placeholder="Origen — busca una dirección en Perú"
            value={originText}
            onChange={v => { setOriginText(v); setOriginPoint(null); clearPreview() }}
            onSelect={r => { setOriginPoint(r.point); setOriginText(r.label) }}
            pickActive={pickMode === 'origin'}
            onPickStart={() => setPickMode('origin')}
            onPickCancel={() => setPickMode(null)}
          />

          <PlaceField
            label="B" placeholder="Destino — busca una dirección en Perú"
            value={destText}
            onChange={v => { setDestText(v); setDestPoint(null); clearPreview() }}
            onSelect={r => { setDestPoint(r.point); setDestText(r.label) }}
            pickActive={pickMode === 'destination'}
            onPickStart={() => setPickMode('destination')}
            onPickCancel={() => setPickMode(null)}
          />

          {/* Opciones */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                Hora de salida (hoy)
              </div>
              <TimePicker
                format="HH:mm" minuteStep={30} placeholder="Ahora"
                value={depTime} onChange={v => { setDepTime(v); clearPreview() }}
                style={{ width: '100%' }}
                use12Hours={false}
                showNow={false}
              />
            </div>
            <div style={{ paddingTop: 18 }}>
              <Checkbox
                checked={avoidTolls}
                onChange={e => { setAvoidTolls(e.target.checked); clearPreview() }}
                style={{ fontSize: 12 }}
              >
                Evitar peajes
              </Checkbox>
            </div>
          </div>

          {/* Resultado de la ruta */}
          {previewRoute && !saveStep && (
            <div style={{
              marginBottom: 14, padding: '12px 14px', borderRadius: 10,
              background: 'var(--color-background-secondary)',
              border: '0.5px solid var(--color-border-secondary)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  fontSize: 20, fontWeight: 500, color: 'var(--color-text-primary)',
                }}>
                  {formatDist(previewRoute.distance)}
                </span>
                <span style={{
                  fontSize: 13, color: 'var(--color-text-secondary)',
                }}>
                  {formatDur(previewRoute.durationSeconds)}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                <span>{dayjs(previewRoute.departureTime).format('HH:mm')}</span>
                <ArrowRightOutlined style={{ fontSize: 10 }} />
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
                  {arrivalTime(previewRoute.durationSeconds)}
                </span>
                <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  (estimado)
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                Ruta mostrada en el mapa. Puedes recalcular o guardar.
              </div>
            </div>
          )}

          {/* Paso de guardar con nombre */}
          {saveStep && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                Nombre de la ruta
              </div>
              <input
                value={saveId}
                onChange={e => setSaveId(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                placeholder="ej. ruta-miraflores-surco"
                autoFocus
                style={{
                  width: '100%', padding: '7px 10px',
                  border: '1px solid var(--color-border-secondary)',
                  borderRadius: 8, fontSize: 13,
                  background: 'var(--color-background-primary)',
                  color: 'var(--color-text-primary)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                Solo letras, números, guiones y guiones bajos
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
                  disabled={!originText.trim() || !destText.trim()}
                  type={previewRoute ? 'default' : 'primary'}
                  style={{ flex: 1 }}
                  icon={<SwapOutlined />}
                >
                  {previewRoute ? 'Recalcular' : 'Calcular'}
                </Button>
                {previewRoute && (
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={() => setSaveStep(true)}
                    style={{ flex: 1 }}
                  >
                    Guardar
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

      {/* Barra flotante cuando el panel está colapsado por selección en mapa */}
      {collapsed && (
        <div style={{
          position:   'absolute',
          bottom:     32,
          left:       '50%',
          transform:  'translateX(-50%)',
          background: 'var(--color-background-primary)',
          border:     '0.5px solid var(--color-border-info)',
          borderRadius: 24,
          padding:    '10px 20px',
          zIndex:     400,
          display:    'flex',
          alignItems: 'center',
          gap:        12,
          boxShadow:  '0 4px 16px rgba(0,0,0,0.12)',
          fontSize:   13,
          color:      'var(--color-text-primary)',
        }}>
          <AimOutlined style={{ color: 'var(--color-text-info)', fontSize: 16 }} />
          <span>
            Selecciona el punto de{' '}
            <strong>{pickMode === 'origin' ? 'origen' : 'destino'}</strong>{' '}
            en el mapa
          </span>
          <button
            onClick={() => setPickMode(null)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-secondary)', padding: 2,
            }}
          >
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        </div>
      )}
    </>
  )
}
