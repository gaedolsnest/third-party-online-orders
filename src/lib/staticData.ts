import type { OnlineOrder } from '../types'

export interface StaticStore {
  store_code: string
  store_name: string
  region: string
  file: string | null
  order_count: number
}

export interface StaticManifest {
  version: string
  generated_at: string
  data_period?: { from: string | null; to: string | null }
  total_orders: number
  ignored_completed: number
  stores: StaticStore[]
}

let manifestPromise: Promise<StaticManifest | null> | null = null

export function loadStaticManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(`./data/manifest.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<StaticManifest> : null)
      .catch(() => null)
  }
  return manifestPromise
}

export async function loadStaticStoreOrders(store: StaticStore, version?: string): Promise<OnlineOrder[]> {
  if (!store.file) return []
  const url = `./data/${store.file}${version ? `?v=${encodeURIComponent(version)}` : ''}`
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { cache: attempt === 0 ? 'force-cache' : 'reload' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as { orders: OnlineOrder[] }
      return data.orders
    } catch (error) {
      if (attempt === 1) throw error
    }
  }
  return []
}
