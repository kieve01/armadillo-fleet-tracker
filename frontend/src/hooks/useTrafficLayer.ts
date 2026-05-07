import { useEffect } from 'react'
import { buildStyleUrl } from '../components/map/mapHelpers'
import { useMapStore } from '../store/mapStore'
import { useUIStore } from '../store/uiStore'

export function useTrafficLayer() {
  const map = useMapStore((s) => s.map)
  const mapReady = useMapStore((s) => s.mapReady)
  const trafficEnabled = useUIStore((s) => s.trafficEnabled)

  useEffect(() => {
    if (!map || !mapReady) return

    const styleUrl = buildStyleUrl(
      import.meta.env.VITE_AWS_REGION,
      import.meta.env.VITE_MAP_STYLE,
      import.meta.env.VITE_MAP_API_KEY,
      trafficEnabled,
    )

    map.setStyle(styleUrl)
  }, [map, mapReady, trafficEnabled])
}
