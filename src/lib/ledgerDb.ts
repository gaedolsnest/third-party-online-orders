import type { OnlineOrder, OrderStatus } from '../types'
import type { ExcelMetadata } from './excel'

const DB_NAME = 'third-party-online-ledger'
const STORE_NAME = 'app_state'
const STATE_KEY = 'ledger'

export type HandlingStatus = '미확인' | '확인 중' | '조치 완료'

export interface LedgerOrder extends OnlineOrder {
  first_seen_at: string
  last_seen_at: string
  previous_status: OrderStatus | null
  missing_from_latest: boolean
  handling_status: HandlingStatus
  handling_memo: string
  handling_updated_at: string | null
}

export interface LedgerSyncSummary {
  total: number
  open: number
  new_count: number
  changed_count: number
  completed_count: number
}

export interface LedgerState {
  version: 1
  orders: LedgerOrder[]
  latest_store_names: string[]
  last_upload: {
    file_name: string
    uploaded_at: string
    period_from: string | null
    period_to: string | null
    summary: LedgerSyncSummary
  } | null
}

const emptyState = (): LedgerState => ({ version: 1, orders: [], latest_store_names: [], last_upload: null })
const orderKey = (order: Pick<OnlineOrder, 'store_name' | 'order_no' | 'line_no' | 'registered_at'>) => `${order.store_name}::${order.order_no}::${order.line_no}::${order.registered_at.slice(0, 10)}`

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

export async function readLedger(): Promise<LedgerState> {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    return await requestResult(transaction.objectStore(STORE_NAME).get(STATE_KEY)) || emptyState()
  } finally { database.close() }
}

export async function writeLedger(state: LedgerState) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    await requestResult(transaction.objectStore(STORE_NAME).put(state, STATE_KEY))
  } finally { database.close() }
}

export async function clearLedger() {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    await requestResult(transaction.objectStore(STORE_NAME).delete(STATE_KEY))
  } finally { database.close() }
}

const dateKey = (value: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function mergeLedger(previous: LedgerState, incoming: OnlineOrder[], fileName: string, metadata: ExcelMetadata): LedgerState {
  const now = new Date().toISOString()
  const incomingStores = [...new Set(incoming.map((order) => order.store_name))].sort((a, b) => a.localeCompare(b, 'ko'))
  const incomingStoreSet = new Set(incomingStores)
  const records = new Map(previous.orders.map((order) => [orderKey(order), { ...order, missing_from_latest: incomingStoreSet.has(order.store_name) ? true : order.missing_from_latest }]))
  let newCount = 0
  let changedCount = 0
  let completedCount = 0

  for (const order of incoming) {
    const key = orderKey(order)
    const existing = records.get(key)
    if (!existing) newCount += 1
    const statusChanged = Boolean(existing && existing.status !== order.status)
    if (statusChanged) changedCount += 1
    if (existing && existing.status !== '정산' && order.status === '정산') completedCount += 1
    records.set(key, {
      ...existing,
      ...order,
      first_seen_at: existing?.first_seen_at || now,
      last_seen_at: now,
      previous_status: statusChanged ? existing!.status : existing?.previous_status || null,
      missing_from_latest: false,
      handling_status: existing?.handling_status || '미확인',
      handling_memo: existing?.handling_memo || '',
      handling_updated_at: existing?.handling_updated_at || null,
    })
  }

  const sourceDates = metadata.source_dates.map(dateKey)
  const registeredDates = incoming.map((order) => dateKey(order.registered_at))
  const periodDates = [...sourceDates, ...registeredDates].filter(Boolean).sort()
  const currentOrders = [...records.values()].filter((order) => !order.missing_from_latest)
  return {
    version: 1,
    orders: [...records.values()],
    latest_store_names: incomingStores,
    last_upload: {
      file_name: fileName,
      uploaded_at: now,
      period_from: periodDates[0] || null,
      period_to: periodDates.at(-1) || null,
      summary: {
        total: incoming.length,
        open: currentOrders.filter((order) => order.status !== '정산').length,
        new_count: previous.last_upload ? newCount : 0,
        changed_count: changedCount,
        completed_count: completedCount,
      },
    },
  }
}

export function updateOrderHandling(
  state: LedgerState,
  target: Pick<OnlineOrder, 'store_name' | 'order_no' | 'line_no' | 'registered_at'>,
  patch: Partial<Pick<LedgerOrder, 'handling_status' | 'handling_memo'>>,
): LedgerState {
  const targetKey = orderKey(target)
  return {
    ...state,
    orders: state.orders.map((order) => orderKey(order) === targetKey
      ? {
          ...order,
          handling_status: order.handling_status || '미확인',
          handling_memo: order.handling_memo || '',
          ...patch,
          handling_updated_at: new Date().toISOString(),
        }
      : order),
  }
}
