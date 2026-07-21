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

export async function loadStaticStoreOrders(store: StaticStore): Promise<OnlineOrder[]> {
  if (!store.file) return []
  const response = await fetch(`./data/${store.file}`, { cache: 'force-cache' })
  if (!response.ok) throw new Error('점포 주문 파일을 불러오지 못했습니다.')
  const data = await response.json() as { orders: OnlineOrder[] }
  return data.orders
}

export async function loadAllStaticOrders(manifest: StaticManifest): Promise<OnlineOrder[]> {
  const active = manifest.stores.filter((store) => store.file)
  const chunks = await Promise.all(active.map(loadStaticStoreOrders))
  return chunks.flat()
}
