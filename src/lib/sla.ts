import type { OnlineOrder, OrderWithSla } from '../types'

const DAY = 24 * 60 * 60 * 1000

const addDays = (value: string, days: number) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : new Date(date.getTime() + days * DAY)
}

const startOfDay = (value: Date) => {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export function withSla(order: OnlineOrder, now = new Date(), shippingDays = 2, settlementDays = 5): OrderWithSla {
  if (order.status === '정산' || order.settled_at) {
    return { ...order, slaLevel: 'complete', slaLabel: '처리 완료', dueAt: null, exceptionType: null }
  }

  const isRegistered = order.status === '등록'
  const dueAt = isRegistered
    ? addDays(order.registered_at, shippingDays)
    : addDays(order.shipped_at || order.registered_at, settlementDays)
  const exceptionType = isRegistered ? 'shipping_delay' : 'settlement_delay'
  const stageLabel = isRegistered ? '출고' : '정산'

  if (!dueAt) return { ...order, slaLevel: 'normal', slaLabel: '확인 필요', dueAt: null, exceptionType }
  const remainingDays = Math.round((startOfDay(dueAt).getTime() - startOfDay(now).getTime()) / DAY)
  if (remainingDays < 0) {
    const overdueDays = Math.abs(remainingDays)
    return { ...order, slaLevel: 'delayed', slaLabel: `${stageLabel} ${overdueDays}일 지연`, dueAt, exceptionType }
  }
  if (remainingDays === 0) return { ...order, slaLevel: 'warning', slaLabel: `${stageLabel} D-DAY`, dueAt, exceptionType }
  if (remainingDays === 1) return { ...order, slaLevel: 'warning', slaLabel: `${stageLabel} 임박`, dueAt, exceptionType }
  return { ...order, slaLevel: 'normal', slaLabel: `${order.status} 완료`, dueAt, exceptionType }
}

export const formatDate = (value: string | Date | null | undefined) => {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ko-KR', { year:'2-digit', month:'2-digit', day:'2-digit' }).format(date)
}
