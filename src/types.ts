export type UserRole = 'admin' | 'store'
export type OrderStatus = '등록' | '출고' | '정산'

export interface UserProfile {
  id: string
  role: UserRole
  store_code: string | null
  display_name: string
}

export interface OnlineOrder {
  id?: string
  source_no: string
  source_flag: string
  order_no: string
  line_no: number
  store_code: string
  store_name: string
  sale_type: string
  brand: string
  product_name: string
  style_code: string
  color: string
  size: string
  quantity: number
  stock_quantity: number
  regular_price: number
  sale_amount: number
  shipping_type: string
  status: OrderStatus
  store_transfer_status: string
  registered_at: string
  shipped_at: string | null
  shipped_by: string
  settled_at: string | null
  settled_by: string
  sales_date: string | null
  pos_no: string
  transaction_no: string
  last_seen_at?: string
  updated_at?: string
}

export type SlaLevel = 'delayed' | 'warning' | 'normal' | 'complete'

export interface OrderWithSla extends OnlineOrder {
  slaLevel: SlaLevel
  slaLabel: string
  dueAt: Date | null
  exceptionType: 'shipping_delay' | 'settlement_delay' | null
}
