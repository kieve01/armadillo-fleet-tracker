import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, AutoComplete, Button, Checkbox,
  Modal, Space, TimePicker, Typography,
} from 'antd'
import {
  EnvironmentOutlined, SwapOutlined,
  SaveOutlined, AimOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useRoutesStore } from '../routesStore'
import { useMapStore } from '../../../store/mapStore'
import type { RouteTravelMode } from '../types'

const BASE = import.meta.env.VITE_API_BASE_URL

interface Props { open: boolean; onCancel: () => void }

interface PlaceSuggestion { value: string; label: string; placeId: string }
interface ResolvedPlace   { label: string; lng: number; lat: number; point: [number, number] }

// ─── Debounce hook ────────────────────────────────────────────────────────────
function useDebounce<T>(value: T, ms: number): T {
  const [dv, setDv] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDv(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return dv
}

// ─── Buscar sugerencias ───────────────────────────────────────────────────────
async function fetchSuggestions(q: string): Promise<PlaceSuggestion[]> {
  if (q.length < 2) return []
  try {
    const r = await fetch(`${BASE}/api/places/suggest?q=${encodeURIComponent(q)}`)
    if (!r.ok) return []
    const data = await r.json() as { text: string; placeId: string }[]
    return data.map(d => ({ value: d.text, label: d.text, placeId: d.placeId }))
  } catch { return [] }
}

// ─── Resolver texto a coordenadas ────────────────────────────────────────────
async function resolvePlace(q: string): Promise<ResolvedPlace | null> {
  try {
    const r = await fetch(`${BASE}/api/places/resolve?q=${encodeURIComponent(q)}`)
    if (!r.ok) return null
    return await r.json() as ResolvedPlace
  } catch { return null }
}

// ─── Componente de campo de lugar con autocompletado ─────────────────────────
function PlaceInput({
  label, value, onChange, onResolved, pickingMap, onStartPick, onCancelPick, disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onResolved: (p: ResolvedPlace) => void
  pickingMap: boolean
  onStartPick: () => void
  onCancelPick: () => void
  disabled?: boolean
}) {
  const [options, setOptions]   = useState<PlaceSuggestion[]>([])
  const [loading, setLoading]   = useState(false)
  const debounced = useDebounce(value, 300)

  useEffect(() => {
    if (!debounced || debounced.length < 2) { setOptions([]); return }
    setLoading(true)
    fetchSuggestions(debounced).then(r => { setOptions(r); setLoading(false) })
  }, [debounced])

  const handleSelect = async (val: string) => {
    onChange(val)
    const resolved = await resolvePlace(val)
    if (resolved) onResolved(resolved)
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <Typography.Text style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>
        {label}
      </Typography.Text>
      <Space.Compact style={{ width: '100%' }}>
        <AutoComplete
          value={value}
          options={options}
          onSearch={onChange}
          onSelect={handleSelect}
          style={{ flex: 1 }}
          disabled={disabled}
          notFoundContent={loading ? 'Buscando...' : value.length >= 2 ? 'Sin resultados' : null}
        >
          <input
            className="ant-input"
            placeholder={`Buscar ${label.toLowerCase()} en Perú...`}
            style={{
              width: '100%', padding: '4px 11px',
              border: '1px solid #d9d9d9', borderRadius: '6px 0 0 6px',
              outline: 'none', fontSize: 14,
            }}
          />
        </AutoComplete>
        <Button
          icon={<AimOutlined />}
          onClick={pickingMap ? onCancelPick : onStartPick}
          type={pickingMap ? 'primary' : 'default'}
          title={pickingMap ? 'Cancelar selección' : 'Seleccionar en mapa'}
          disabled={disabled}
        />
      </Space.Compact>
      {pickingMap && (
        <Typography.Text
          type="secondary"
          style={{ fontSize: 11, marginTop: 4, display: 'block', color: '#00418b' }}
        >
          <EnvironmentOutlined /> Haz clic en el mapa para seleccionar el punto
        </Typography.Text>
      )}
    </div>
  )
}

// ─── Modal principal ──────────────────────────────────────────────────────────
export default function RouteCalculatorModal({ open, onCancel }: Props) {
  const map              = useMapStore(s => s.map)
  const loading          = useRoutesStore(s => s.loading)
  const error            = useRoutesStore(s => s.error)
  const previewRoute     = useRoutesStore(s => s.previewRoute)
  const runCalculate     = useRoutesStore(s => s.runCalculate)
  const savePreviewRoute = useRoutesStore(s => s.savePreviewRoute)
  const clearPreview     = useRoutesStore(s => s.clearPreview)

  const [originText, setOriginText]       = useState('')
  const [destText,   setDestText]         = useState('')
  const [originPoint, setOriginPoint]     = useState<[number, number] | null>(null)
  const [destPoint,   setDestPoint]       = useState<[number, number] | null>(null)
  const [avoidTolls,  setAvoidTolls]      = useState(false)
  const [departureTime, setDepartureTime] = useState<dayjs.Dayjs | null>(null)
  const [pickMode, setPickMode]           = useState<'origin' | 'destination' | null>(null)
  const [saveId,   setSaveId]             = useState('')
  const [saveOpen, setSaveOpen]           = useState(false)
  const [saving,   setSaving]             = useState(false)
  const [localError, setLocalError]       = useState<string | null>(null)

  // Ref para saber si el modal está abierto dentro del listener del mapa
  const pickModeRef = useRef<'origin' | 'destination' | null>(null)
  useEffect(() => { pickModeRef.current = pickMode }, [pickMode])

  // ── Click en mapa ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !open) return

    const onClick = async (e: any) => {
      const mode = pickModeRef.current
      if (!mode) return

      const { lat, lng } = e.lngLat
      const point: [number, number] = [lng, lat]

      // Resolver coordenada a nombre de lugar
      const resolved = await resolvePlace(`${lat},${lng}`)
      const label    = resolved?.label ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`

      if (mode === 'origin') {
        setOriginText(label)
        setOriginPoint(point)
      } else {
        setDestText(label)
        setDestPoint(point)
      }
      setPickMode(null)
    }

    map.on('click', onClick)
    return () => { map.off('click', onClick) }
  }, [map, open])

  // Cursor del mapa
  useEffect(() => {
    if (!map) return
    map.getCanvas().style.cursor = pickMode ? 'crosshair' : ''
    return () => { map.getCanvas().style.cursor = '' }
  }, [map, pickMode])

  const handleCancel = useCallback(() => {
    setPickMode(null)
    setOriginText(''); setOriginPoint(null)
    setDestText('');   setDestPoint(null)
    setAvoidTolls(false); setDepartureTime(null)
    setSaveId(''); setLocalError(null)
    clearPreview()
    onCancel()
  }, [clearPreview, onCancel])

  const handleCalculate = async () => {
    setLocalError(null)
    if (!originPoint && !originText) { setLocalError('Ingresa un origen'); return }
    if (!destPoint   && !destText)   { setLocalError('Ingresa un destino'); return }

    // Si no tenemos el punto resuelto aún, resolverlo ahora
    let origin = originPoint
    let dest   = destPoint

    if (!origin) {
      const r = await resolvePlace(originText)
      if (!r) { setLocalError('No se encontró el origen. Intenta con otra descripción.'); return }
      origin = r.point; setOriginPoint(r.point); setOriginText(r.label)
    }
    if (!dest) {
      const r = await resolvePlace(destText)
      if (!r) { setLocalError('No se encontró el destino. Intenta con otra descripción.'); return }
      dest = r.point; setDestPoint(r.point); setDestText(r.label)
    }


    await runCalculate({
      origin,
      destination:   dest,
      travelMode:    'Car' as RouteTravelMode,
      avoidTolls,
    })
  }

  const handleSave = async () => {
    if (!saveId.trim()) return
    setSaving(true)
    await savePreviewRoute(saveId.trim())
    setSaving(false)
    setSaveOpen(false)
    handleCancel()
  }

  const formatDist = (d: number | null) => {
    if (d == null) return '-'
    return d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`
  }

  const formatDur = (s: number | null) => {
    if (s == null) return '-'
    const m = Math.round(s / 60)
    if (m < 60) return `~${m} min`
    const h = Math.floor(m / 60); const rm = m % 60
    return rm ? `~${h} h ${rm} min` : `~${h} h`
  }

  const displayError = localError ?? error

  return (
    <>
      <Modal
        title="Calcular ruta óptima"
        open={open}
        onCancel={handleCancel}
        footer={null}
        width={460}
        destroyOnHidden
        // No cerrar al hacer clic fuera — el usuario puede estar seleccionando en el mapa
        maskClosable={!pickMode}
      >
        {displayError && (
          <Alert
            type="error" showIcon
            message={displayError}
            style={{ marginBottom: 16 }}
            description={
              displayError.includes('terrestre') || displayError.includes('mar')
                ? 'Mueve los puntos a una zona con vías accesibles.'
                : undefined
            }
          />
        )}

        <PlaceInput
          label="Origen"
          value={originText}
          onChange={v => { setOriginText(v); setOriginPoint(null); clearPreview() }}
          onResolved={r => { setOriginPoint(r.point); setOriginText(r.label) }}
          pickingMap={pickMode === 'origin'}
          onStartPick={() => setPickMode('origin')}
          onCancelPick={() => setPickMode(null)}
        />

        <PlaceInput
          label="Destino"
          value={destText}
          onChange={v => { setDestText(v); setDestPoint(null); clearPreview() }}
          onResolved={r => { setDestPoint(r.point); setDestText(r.label) }}
          pickingMap={pickMode === 'destination'}
          onStartPick={() => setPickMode('destination')}
          onCancelPick={() => setPickMode(null)}
        />

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <Typography.Text style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>
              Hora de salida (hoy)
            </Typography.Text>
            <TimePicker
              format="HH:mm"
              minuteStep={15}
              placeholder="Ahora"
              value={departureTime}
              onChange={v => { setDepartureTime(v); clearPreview() }}
              style={{ width: '100%' }}
              use12Hours={false}
            />
          </div>
          <div style={{ paddingBottom: 4 }}>
            <Checkbox
              checked={avoidTolls}
              onChange={e => { setAvoidTolls(e.target.checked); clearPreview() }}
            >
              Evitar peajes
            </Checkbox>
          </div>
        </div>

        <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 16 }}>
          Los puntos se ajustan automáticamente a la vía más cercana.
          No se calculan rutas que requieran cruzar cuerpos de agua.
          La hora de salida estima tiempos según patrones históricos de tráfico.
        </Typography.Text>

        {/* Preview del resultado */}
        {previewRoute && (
          <div style={{
            background: '#f0f7ff', border: '1px solid #bae0ff',
            borderRadius: 8, padding: '12px 16px', marginBottom: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Typography.Text strong style={{ fontSize: 16 }}>
                  {formatDist(previewRoute.distance)}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                  {formatDur(previewRoute.durationSeconds)}
                </Typography.Text>
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                Salida {dayjs(previewRoute.departureTime).format('HH:mm')}
              </Typography.Text>
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
              Ruta trazada en el mapa (línea azul). Puedes guardarla o recalcular con otros parámetros.
            </Typography.Text>
          </div>
        )}

        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={handleCancel}>Cancelar</Button>
          <Button
            icon={<SwapOutlined />}
            loading={loading}
            onClick={handleCalculate}
            disabled={(!originText && !originPoint) || (!destText && !destPoint)}
          >
            Calcular
          </Button>
          {previewRoute && (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => setSaveOpen(true)}
            >
              Guardar ruta
            </Button>
          )}
        </Space>
      </Modal>

      {/* Modal guardar con nombre */}
      <Modal
        title="Guardar ruta calculada"
        open={saveOpen}
        onOk={handleSave}
        onCancel={() => { setSaveOpen(false); setSaveId('') }}
        okText="Guardar"
        cancelText="Cancelar"
        confirmLoading={saving}
        destroyOnHidden
      >
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {originText} → {destText}
        </Typography.Text>
        <input
          className="ant-input"
          placeholder="ej. ruta-miraflores-surco"
          value={saveId}
          onChange={e => setSaveId(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
          autoFocus
          style={{
            width: '100%', padding: '4px 11px',
            border: '1px solid #d9d9d9', borderRadius: 6,
            fontSize: 14, outline: 'none',
          }}
        />
        <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
          Solo letras, números, guiones y guiones bajos.
        </Typography.Text>
      </Modal>
    </>
  )
}
