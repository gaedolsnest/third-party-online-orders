import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import * as XLSX from 'xlsx'

const [masterArg, ordersArg, outputArg] = process.argv.slice(2)
if (!masterArg || !ordersArg) {
  console.error('사용법: npm run generate:data -- <점포마스터.xlsx> <정산대상.xlsx> [출력폴더]')
  process.exit(1)
}

const masterPath = resolve(masterArg)
const ordersPath = resolve(ordersArg)
const outputPath = resolve(outputArg || 'public/data')
const normalize = (value) => String(value ?? '').trim().normalize('NFKC').replace(/\s+/g, '').toLowerCase()
const text = (value) => String(value ?? '').trim()
const number = (value, fallback = 0) => Number(String(value ?? '').replace(/,/g, '')) || fallback

function firstSheet(path) {
  const workbook = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  return { sheetName, sheet: workbook.Sheets[sheetName] }
}

function isoDate(value, timeValue) {
  if (value === '' || value === null || value === undefined) return null
  let parsed = null
  if (value instanceof Date) parsed = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  else if (typeof value === 'number') {
    const serial = XLSX.SSF.parse_date_code(value)
    if (serial) parsed = new Date(serial.y, serial.m - 1, serial.d)
  } else {
    const match = text(value).replace(/[./]/g, '-').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (match) parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }
  if (!parsed || Number.isNaN(parsed.getTime())) return null
  if (timeValue !== '' && timeValue !== null && timeValue !== undefined) {
    if (timeValue instanceof Date) parsed.setHours(timeValue.getHours(), timeValue.getMinutes(), timeValue.getSeconds())
    else if (typeof timeValue === 'number') {
      const seconds = Math.round((timeValue % 1) * 86400)
      parsed.setHours(Math.floor(seconds / 3600) % 24, Math.floor((seconds % 3600) / 60), seconds % 60)
    } else {
      const match = text(timeValue).match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
      if (match) parsed.setHours(Number(match[1]), Number(match[2]), Number(match[3] || 0))
    }
  }
  return parsed.toISOString()
}

function koreaDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const getPart = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${getPart('year')}-${getPart('month')}-${getPart('day')}`
}

function parseMaster() {
  const { sheetName, sheet } = firstSheet(masterPath)
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
  const headerIndex = rows.findIndex((row) => row.some((cell) => ['점코드', '점포코드', '매장코드'].includes(text(cell))) && row.some((cell) => ['점명', '점포명', '매장명'].includes(text(cell))))
  if (headerIndex < 0) throw new Error('점포마스터에서 점코드와 점명 헤더를 찾지 못했습니다.')
  const headers = rows[headerIndex].map(text)
  const codeIndex = headers.findIndex((header) => ['점코드', '점포코드', '매장코드'].includes(header))
  const nameIndex = headers.findIndex((header) => ['점명', '점포명', '매장명'].includes(header))
  const regionIndex = headers.findIndex((header) => ['지역명', '지역'].includes(header))
  const stores = rows.slice(headerIndex + 1).map((row, index) => {
    const rawCode = text(row[codeIndex]).replace(/\.0$/, '')
    return { row: headerIndex + index + 2, store_code: /^\d+$/.test(rawCode) ? rawCode.padStart(4, '0') : rawCode, store_name: text(row[nameIndex]), region: regionIndex >= 0 ? text(row[regionIndex]) : '' }
  }).filter((store) => store.store_code || store.store_name)
  const invalid = stores.filter((store) => !/^\d{4}$/.test(store.store_code) || !store.store_name)
  if (invalid.length) throw new Error(`점포마스터 형식 오류: ${invalid.slice(0, 5).map((store) => `${store.row}행`).join(', ')}`)
  const unique = [...new Map(stores.map((store) => [store.store_code, store])).values()]
  return { sheetName, stores: unique }
}

function parseOrders() {
  const { sheetName, sheet } = firstSheet(ordersPath)
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })
  const headerRow = matrix.findIndex((row) => row.some((cell) => text(cell) === '진행상태') && row.some((cell) => text(cell) === '주문번호(비고)'))
  if (headerRow < 0) throw new Error('주문 파일의 헤더를 찾지 못했습니다.')
  const top = [...matrix[headerRow]]
  for (const merge of sheet['!merges'] || []) {
    if (merge.s.r !== headerRow || merge.e.r !== headerRow) continue
    for (let column = merge.s.c; column <= merge.e.c; column += 1) top[column] = top[merge.s.c]
  }
  const second = matrix[headerRow + 1] || []
  const hasSecondHeader = second.some((cell) => ['출고일', '정산일', '매출일자'].includes(text(cell)))
  const width = Math.max(top.length, second.length)
  const headers = Array.from({ length: width }, (_, column) => text(second[column]) || text(top[column]) || `__${column}`)
  const column = (name) => headers.findIndex((header) => normalize(header) === normalize(name))
  const columns = Object.fromEntries([
    'No', 'F', '매장명', '등록일자', '순번', '판매구분', '브랜드', '상품명', '스타일', '컬러', '사이즈', '수량', '현재고', '정상가', '판매금액', '발송구분', '진행상태', '점출입상태', '주문번호(비고)', '출고일', '출고자', '출고시간', '정산일', '정산자', '정산시간', '매출일자', 'POS번호', '거래번호'
  ].map((name) => [name, column(name)]))
  const get = (row, name) => columns[name] >= 0 ? row[columns[name]] : ''
  const dataStart = headerRow + (hasSecondHeader ? 2 : 1)
  let ignoredCompleted = 0
  const sourceDates = []
  const parsed = []
  for (let index = dataStart; index < matrix.length; index += 1) {
    const row = matrix[index]
    if (!row.some((value) => text(value))) continue
    const status = text(get(row, '진행상태'))
    if (!status) continue
    const sourceNo = text(get(row, 'No'))
    const registeredAt = isoDate(get(row, '등록일자'))
    if (registeredAt) sourceDates.push(koreaDateKey(registeredAt))
    if (status === '정산') { ignoredCompleted += 1; continue }
    const storeName = text(get(row, '매장명'))
    const lineNo = number(get(row, '순번'), 1)
    const orderNo = text(get(row, '주문번호(비고)')) || `${registeredAt?.slice(0, 10) || '등록일 미입력'} / 순번 ${lineNo}`
    if (!orderNo || !storeName || !registeredAt || !['등록', '출고', '정산'].includes(status)) throw new Error(`주문 파일 ${index + 1}행의 필수값을 확인해 주세요.`)
    parsed.push({
      source_no: sourceNo, source_flag: text(get(row, 'F')), order_no: orderNo,
      line_no: lineNo, store_code: '', store_name: storeName,
      sale_type: text(get(row, '판매구분')), brand: text(get(row, '브랜드')), product_name: text(get(row, '상품명')),
      style_code: text(get(row, '스타일')), color: text(get(row, '컬러')), size: text(get(row, '사이즈')),
      quantity: number(get(row, '수량'), 1), stock_quantity: number(get(row, '현재고')), regular_price: number(get(row, '정상가')),
      sale_amount: number(get(row, '판매금액')), shipping_type: text(get(row, '발송구분')), status,
      store_transfer_status: text(get(row, '점출입상태')), registered_at: registeredAt,
      shipped_at: isoDate(get(row, '출고일'), get(row, '출고시간')), shipped_by: text(get(row, '출고자')),
      settled_at: isoDate(get(row, '정산일'), get(row, '정산시간')), settled_by: text(get(row, '정산자')),
      sales_date: isoDate(get(row, '매출일자')), pos_no: text(get(row, 'POS번호')), transaction_no: text(get(row, '거래번호')),
    })
  }
  sourceDates.sort()
  return {
    sheetName,
    orders: [...new Map(parsed.map((order) => [`${order.order_no}::${order.line_no}`, order])).values()],
    ignoredCompleted,
    dataPeriod: { from: sourceDates[0] || null, to: sourceDates.at(-1) || null },
  }
}

const master = parseMaster()
const source = parseOrders()
const storeByName = new Map(master.stores.map((store) => [normalize(store.store_name), store]))
const unmatched = [...new Set(source.orders.filter((order) => !storeByName.has(normalize(order.store_name))).map((order) => order.store_name))]
if (unmatched.length) throw new Error(`점포마스터 미매칭 ${unmatched.length}개: ${unmatched.slice(0, 10).join(', ')}`)
const excludedStores = master.stores.filter((store) => store.store_name.includes('반품매장'))
const excludedNames = new Set(excludedStores.map((store) => normalize(store.store_name)))
const resolved = source.orders
  .filter((order) => !excludedNames.has(normalize(order.store_name)))
  .map((order) => ({ ...order, store_code: storeByName.get(normalize(order.store_name)).store_code }))
const activeStoreCodes = new Set(resolved.map((order) => order.store_code))
const visibleStores = master.stores.filter((store) => activeStoreCodes.has(store.store_code))
const sourceHash = createHash('sha256').update(readFileSync(masterPath)).update(readFileSync(ordersPath)).digest('hex')
const version = sourceHash.slice(0, 12)
const previousManifestPath = join(outputPath, 'manifest.json')
let previousManifest = null
if (existsSync(previousManifestPath)) {
  try { previousManifest = JSON.parse(readFileSync(previousManifestPath, 'utf8')) }
  catch { previousManifest = null }
}
const generatedAt = previousManifest?.version === version ? previousManifest.generated_at : new Date().toISOString()
const storesPath = join(outputPath, 'stores')
rmSync(outputPath, { recursive: true, force: true })
mkdirSync(storesPath, { recursive: true })
const grouped = Map.groupBy(resolved, (order) => order.store_code)
const manifestStores = visibleStores.sort((a, b) => a.store_name.localeCompare(b.store_name, 'ko')).map((store) => {
  const orders = grouped.get(store.store_code) || []
  const file = orders.length ? `stores/${createHash('sha256').update(`${version}:${store.store_code}`).digest('hex').slice(0, 20)}.json` : null
  if (file) writeFileSync(join(outputPath, file), JSON.stringify({ version, generated_at: generatedAt, store, orders }))
  return { ...store, file, order_count: orders.length }
})
const manifest = { version, generated_at: generatedAt, data_period: source.dataPeriod, source: { master_sheet: master.sheetName, orders_sheet: source.sheetName }, total_orders: resolved.length, ignored_completed: source.ignoredCompleted, stores: manifestStores }
writeFileSync(join(outputPath, 'manifest.json'), JSON.stringify(manifest))
console.log(JSON.stringify({ output: outputPath, version, data_period: source.dataPeriod, stores: visibleStores.length, excluded_return_stores: excludedStores.length, stores_with_orders: grouped.size, open_orders: resolved.length, ignored_completed: source.ignoredCompleted }, null, 2))
