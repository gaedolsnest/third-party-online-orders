import * as XLSX from 'xlsx'
import type { OnlineOrder, OrderStatus } from '../types'

type SheetRow = Record<string, unknown>
type SheetMatrix = unknown[][]

export interface ExcelMetadata {
  store_name: string
  source_dates: string[]
  sheet_name: string
}

export interface ParsedLedgerExcel {
  orders: OnlineOrder[]
  metadata: ExcelMetadata
}

const names: Record<string, string[]> = {
  source_no: ['No', '번호', 'source_no'],
  source_flag: ['F', 'source_flag'],
  order_no: ['주문번호(비고)', '주문번호', 'order_no'], line_no: ['순번', 'line_no'],
  store_code: ['점포번호', 'store_code'], store_name: ['매장명', '점포명', 'store_name'],
  registered_at: ['등록일자', '등록일', 'registered_at'], sale_type: ['판매구분'], brand: ['브랜드'],
  product_name: ['상품명', 'product_name'], style_code: ['스타일'], color: ['컬러'], size: ['사이즈'],
  quantity: ['수량'], stock_quantity: ['현재고'], regular_price: ['정상가'], sale_amount: ['판매금액'],
  shipping_type: ['발송구분'], status: ['진행상태', 'status'], store_transfer_status: ['점출입상태'],
  shipped_at: ['출고일', 'ship_date'], shipped_by: ['출고자', 'shipped_by'], ship_time: ['출고시간'],
  settled_at: ['정산일', 'settle_date'], settled_by: ['정산자', 'settled_by'], settle_time: ['정산시간'],
  sales_date: ['매출일자'], pos_no: ['POS번호'], transaction_no: ['거래번호'],
}

const normalized = (value: unknown) => String(value ?? '').replace(/\s+/g, '').trim().toLowerCase()
const text = (value: unknown) => String(value ?? '').trim()
const number = (value: unknown, fallback = 0) => Number(String(value ?? '').replace(/,/g, '')) || fallback

const get = (row: SheetRow, field: string) => {
  const found = Object.keys(row).find((key) => names[field].some((name) => normalized(name) === normalized(key)))
  return found ? row[found] : ''
}

const timeParts = (value: unknown): [number, number, number] | null => {
  if (value === '' || value === null || value === undefined) return null
  if (value instanceof Date) return [value.getHours(), value.getMinutes(), value.getSeconds()]
  if (typeof value === 'number') {
    const seconds = Math.round((value % 1) * 86400)
    return [Math.floor(seconds / 3600) % 24, Math.floor((seconds % 3600) / 60), seconds % 60]
  }
  const match = text(value).match(/(\d{1,2})\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : null
}

const date = (value: unknown, time?: unknown): string | null => {
  if (value === '' || value === null || value === undefined) return null
  let parsed: Date | null = null
  if (value instanceof Date) parsed = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  else if (typeof value === 'number') {
    const serial = XLSX.SSF.parse_date_code(value)
    if (serial) parsed = new Date(serial.y, serial.m - 1, serial.d)
  } else {
    const raw = text(value).replace(/[./]/g, '-').replace(/\s+/g, '')
    const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (match) parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    else {
      const fallback = new Date(raw)
      if (!Number.isNaN(fallback.getTime())) parsed = fallback
    }
  }
  if (!parsed || Number.isNaN(parsed.getTime())) return null
  const parts = timeParts(time)
  if (parts) parsed.setHours(parts[0], parts[1], parts[2], 0)
  return parsed.toISOString()
}

function locateHeaders(matrix: SheetMatrix) {
  const headerRow = matrix.findIndex((row) => {
    const cells = row.map(normalized)
    return cells.includes(normalized('진행상태')) && cells.includes(normalized('주문번호(비고)')) && cells.includes(normalized('등록일자'))
  })
  if (headerRow < 0) throw new Error('진행상태, 주문번호(비고), 등록일자가 포함된 헤더 행을 찾지 못했습니다.')
  const second = matrix[headerRow + 1] || []
  const hasSecondHeader = second.some((cell) => ['출고일', '출고자', '출고시간', '정산일', '정산자', '정산시간', '매출일자', 'POS번호', '거래번호'].some((name) => normalized(name) === normalized(cell)))
  return { headerRow, hasSecondHeader, dataRow: headerRow + (hasSecondHeader ? 2 : 1) }
}

function buildHeaders(sheet: XLSX.WorkSheet, matrix: SheetMatrix, headerRow: number, hasSecondHeader: boolean) {
  const top = [...(matrix[headerRow] || [])]
  const bottom = hasSecondHeader ? matrix[headerRow + 1] || [] : []
  for (const merge of sheet['!merges'] || []) {
    if (merge.s.r !== headerRow || merge.e.r !== headerRow) continue
    const label = top[merge.s.c]
    for (let column = merge.s.c; column <= merge.e.c; column += 1) top[column] = label
  }
  const width = Math.max(top.length, bottom.length)
  return Array.from({ length: width }, (_, column) => text(bottom[column]) || text(top[column]) || `__column_${column}`)
}

function extractMetadata(matrix: SheetMatrix, headerRow: number): Omit<ExcelMetadata, 'sheet_name'> {
  let storeName = ''
  const sourceDates = new Set<string>()
  for (const row of matrix.slice(0, headerRow)) {
    for (let column = 0; column < row.length; column += 1) {
      const raw = text(row[column])
      const storeMatch = raw.match(/^(?:점포명|매장명)\s*[:：]?\s*(.*)$/)
      if (storeMatch && !storeName) {
        storeName = text(storeMatch[1]) || text(row.slice(column + 1).find((value) => text(value)))
      }
      if (row[column] instanceof Date) {
        const parsed = date(row[column])
        if (parsed) sourceDates.add(parsed)
      } else {
        for (const match of raw.matchAll(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/g)) {
          const parsed = date(`${match[1]}-${match[2]}-${match[3]}`)
          if (parsed) sourceDates.add(parsed)
        }
      }
    }
  }
  return { store_name: storeName, source_dates: [...sourceDates].sort() }
}

export function parseOrderSheet(sheet: XLSX.WorkSheet, options: { includeCompleted?: boolean; defaultStoreName?: string } = {}): OnlineOrder[] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true }) as SheetMatrix
  if (!matrix.length) throw new Error('엑셀 파일에 데이터가 없습니다.')
  const { headerRow, hasSecondHeader, dataRow } = locateHeaders(matrix)
  const metadata = extractMetadata(matrix, headerRow)
  const headers = buildHeaders(sheet, matrix, headerRow, hasSecondHeader)
  const rows = matrix.slice(dataRow)
    .map((values) => Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ''])))
    .filter((row) => Object.values(row).some((value) => text(value)))
    .filter((row) => text(get(row, 'status')))
    // 기존 조회 페이지는 정산 완료를 제외하고, 로컬 대장은 완료 이력까지 읽는다.
    .filter((row) => options.includeCompleted || text(get(row, 'status')) !== '정산')

  const parsed = rows.map((row, index): OnlineOrder => {
    const excelRow = dataRow + index + 1
    const sourceNo = text(get(row, 'source_no'))
    const storeName = text(get(row, 'store_name')) || options.defaultStoreName || metadata.store_name
    // 현재 원본에는 점포번호가 없으므로 매장명을 점포 분리 키로 사용한다.
    // 향후 점포 마스터가 연결되면 명시적인 store_code가 매장명보다 우선한다.
    const storeCode = text(get(row, 'store_code')) || storeName
    const registeredAt = date(get(row, 'registered_at'))
    const lineNo = number(get(row, 'line_no'), 1)
    const orderNo = text(get(row, 'order_no')) || `${registeredAt?.slice(0, 10) || '등록일 미입력'} / 순번 ${lineNo}`
    const rawStatus = text(get(row, 'status'))
    if (!orderNo || !storeName || !registeredAt) throw new Error(`${excelRow}행의 주문번호(비고), 매장명(C열), 등록일자를 확인해 주세요.`)
    if (!['등록', '출고', '정산'].includes(rawStatus)) throw new Error(`${excelRow}행의 진행상태는 등록/출고/정산 중 하나여야 합니다.`)
    return {
      source_no: sourceNo, source_flag: text(get(row, 'source_flag')),
      order_no: orderNo, line_no: lineNo,
      store_code: storeCode, store_name: storeName, sale_type: text(get(row, 'sale_type')),
      brand: text(get(row, 'brand')), product_name: text(get(row, 'product_name')), style_code: text(get(row, 'style_code')),
      color: text(get(row, 'color')), size: text(get(row, 'size')), quantity: number(get(row, 'quantity'), 1),
      stock_quantity: number(get(row, 'stock_quantity')), regular_price: number(get(row, 'regular_price')),
      sale_amount: number(get(row, 'sale_amount')), shipping_type: text(get(row, 'shipping_type')),
      status: rawStatus as OrderStatus, store_transfer_status: text(get(row, 'store_transfer_status')),
      registered_at: registeredAt, shipped_at: date(get(row, 'shipped_at'), get(row, 'ship_time')),
      shipped_by: text(get(row, 'shipped_by')), settled_at: date(get(row, 'settled_at'), get(row, 'settle_time')),
      settled_by: text(get(row, 'settled_by')), sales_date: date(get(row, 'sales_date')),
      pos_no: text(get(row, 'pos_no')), transaction_no: text(get(row, 'transaction_no')),
    }
  })
  const unique = new Map(parsed.map((order) => [`${order.order_no}::${order.line_no}`, order]))
  return [...unique.values()]
}

export async function parseOrderExcel(file: File): Promise<OnlineOrder[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('첫 번째 시트를 읽을 수 없습니다.')
  return parseOrderSheet(sheet)
}

export async function parseLedgerExcel(file: File): Promise<ParsedLedgerExcel> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error('첫 번째 시트를 읽을 수 없습니다.')
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true }) as SheetMatrix
  const { headerRow } = locateHeaders(matrix)
  const metadata = { ...extractMetadata(matrix, headerRow), sheet_name: sheetName }
  return {
    orders: parseOrderSheet(sheet, { includeCompleted: true, defaultStoreName: metadata.store_name }),
    metadata,
  }
}
