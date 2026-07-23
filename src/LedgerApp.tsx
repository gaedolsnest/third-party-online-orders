import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, Check, CircleAlert, Clock3, FileDown, FileSpreadsheet, MonitorDown, PackageCheck, RefreshCw, Search, ShieldCheck, Store, Trash2, UploadCloud } from 'lucide-react'
import { clearLedger, mergeLedger, readLedger, updateOrderHandling, writeLedger, type HandlingStatus, type LedgerOrder, type LedgerState } from './lib/ledgerDb'
import { formatDate, withSla } from './lib/sla'
import type { OrderWithSla } from './types'

type Filter = 'all' | 'shipping_delay' | 'settlement_delay' | 'warning'
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
type InstallWindow = Window & { __ledgerInstallPrompt?: InstallPromptEvent | null }
const filterLabels: Record<Filter, string> = { all: '전체 예외', shipping_delay: '출고 지연', settlement_delay: '정산 지연', warning: 'D-DAY · 임박' }
const emptyLedger: LedgerState = { version: 1, orders: [], latest_store_names: [], last_upload: null }
type LedgerOrderWithSla = OrderWithSla & LedgerOrder

const periodDate = (value: string | null | undefined) => value ? value.replace(/-/g, '.') : '—'

function LedgerApp() {
  const inputRef = useRef<HTMLInputElement>(null)
  const ledgerRef = useRef<LedgerState>(emptyLedger)
  const [ledger, setLedger] = useState<LedgerState>(emptyLedger)
  const [booting, setBooting] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [activeStore, setActiveStore] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [installMessage, setInstallMessage] = useState('')
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)

  useEffect(() => {
    document.title = '타사 온라인 대장관리'
    readLedger().then((state) => {
      ledgerRef.current = state
      setLedger(state)
      setActiveStore(state.latest_store_names[0] || '')
    }).catch(() => setError('이 브라우저의 대장을 불러오지 못했습니다.')).finally(() => setBooting(false))
  }, [])

  useEffect(() => {
    const installWindow = window as InstallWindow
    const handlePrompt = (event: Event) => {
      event.preventDefault()
      const prompt = event as InstallPromptEvent
      installWindow.__ledgerInstallPrompt = prompt
      setInstallPrompt(prompt)
      setInstallMessage('')
    }
    const handleReady = () => {
      if (installWindow.__ledgerInstallPrompt) {
        setInstallPrompt(installWindow.__ledgerInstallPrompt)
        setInstallMessage('')
      }
    }
    const handleInstalled = () => {
      installWindow.__ledgerInstallPrompt = null
      setInstallPrompt(null)
      setInstallMessage('설치가 완료되었습니다. 바탕화면이나 시작 메뉴에서 앱을 실행해 주세요.')
    }
    handleReady()
    window.addEventListener('beforeinstallprompt', handlePrompt)
    window.addEventListener('ledger-install-ready', handleReady)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt)
      window.removeEventListener('ledger-install-ready', handleReady)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const installApp = async () => {
    const installWindow = window as InstallWindow
    const prompt = installPrompt || installWindow.__ledgerInstallPrompt
    if (!prompt) {
      setInstallMessage('설치 준비가 완료되지 않았습니다. 페이지를 새로고침한 뒤 PC에 앱 설치 버튼을 다시 눌러 주세요.')
      return
    }
    await prompt.prompt()
    const choice = await prompt.userChoice
    installWindow.__ledgerInstallPrompt = null
    setInstallPrompt(null)
    setInstallMessage(choice.outcome === 'accepted'
      ? '설치가 완료되었습니다. 바탕화면이나 시작 메뉴에서 앱을 실행해 주세요.'
      : '설치가 취소되었습니다. 필요할 때 다시 눌러 주세요.')
  }

  const importExcel = async (file?: File) => {
    if (!file) return
    setUploading(true); setError('')
    try {
      if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('Excel 파일(.xlsx, .xls)을 선택해 주세요.')
      const { parseLedgerExcel } = await import('./lib/excel')
      const parsed = await parseLedgerExcel(file)
      if (!parsed.orders.length) throw new Error('주문 데이터가 없습니다. Excel 조회조건과 헤더를 확인해 주세요.')
      const incomingStores = new Set(parsed.orders.map((order) => order.store_name))
      const current = ledgerRef.current
      const overlaps = current.latest_store_names.some((store) => incomingStores.has(store))
      if (current.orders.length && !overlaps && !window.confirm('현재 대장과 다른 점포의 파일입니다. 이 파일의 점포를 대장에 추가할까요?')) return
      const next = mergeLedger(current, parsed.orders, file.name, parsed.metadata)
      await writeLedger(next)
      ledgerRef.current = next
      setLedger(next)
      setActiveStore((current) => next.latest_store_names.includes(current) ? current : next.latest_store_names[0] || '')
      setFilter('all'); setQuery('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Excel을 불러오지 못했습니다.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const resetLedger = async () => {
    if (!window.confirm('이 PC에 저장된 주문 대장을 모두 초기화할까요? 원본 Excel은 삭제되지 않습니다.')) return
    await clearLedger()
    ledgerRef.current = emptyLedger
    setLedger(emptyLedger); setActiveStore(''); setFilter('all'); setQuery('')
  }

  const saveHandling = async (order: LedgerOrder, patch: Partial<Pick<LedgerOrder, 'handling_status' | 'handling_memo'>>) => {
    const next = updateOrderHandling(ledgerRef.current, order, patch)
    ledgerRef.current = next
    setLedger(next)
    try {
      await writeLedger(next)
    } catch {
      setError('매장 처리상태를 저장하지 못했습니다. 다시 시도해 주세요.')
    }
  }

  const exportLedger = async () => {
    setExporting(true); setError('')
    try {
      const storeLedger = ledgerRef.current.orders.filter((order) => order.store_name === activeStore)
      if (!storeLedger.length) throw new Error('저장할 주문 대장이 없습니다.')
      const { downloadLedgerExcel } = await import('./lib/excel')
      downloadLedgerExcel(storeLedger, activeStore)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '대장 Excel을 저장하지 못했습니다.')
    } finally {
      setExporting(false)
    }
  }

  const storeOrders = useMemo(() => ledger.orders.filter((order) => order.store_name === activeStore && !order.missing_from_latest && order.status !== '정산'), [ledger.orders, activeStore])
  const enriched = useMemo(() => storeOrders.map((order) => withSla(order) as LedgerOrderWithSla), [storeOrders])
  const visible = useMemo(() => enriched.filter((order) => {
    const matchesFilter = filter === 'all' || (filter === 'warning' ? order.slaLevel === 'warning' : order.slaLevel === 'delayed' && order.exceptionType === filter)
    const needle = query.trim().toLowerCase()
    return matchesFilter && (!needle || [order.order_no, order.brand, order.product_name, order.style_code].some((value) => value.toLowerCase().includes(needle)))
  }).sort((a, b) => {
    const priority = Number(a.slaLevel !== 'delayed') - Number(b.slaLevel !== 'delayed')
    if (priority) return priority
    return (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
  }), [enriched, filter, query])
  const counts = useMemo(() => ({
    shipping: enriched.filter((order) => order.slaLevel === 'delayed' && order.exceptionType === 'shipping_delay').length,
    settlement: enriched.filter((order) => order.slaLevel === 'delayed' && order.exceptionType === 'settlement_delay').length,
    warning: enriched.filter((order) => order.slaLevel === 'warning').length,
  }), [enriched])

  if (!isStandalone) return <main className="ledger-empty-page ledger-install-only">
    <section className="ledger-empty-card ledger-install-card">
      <div className="brand"><span className="brand-mark"><img src="./abc-mart-black.svg" alt="ABC-MART" /></span><span>타사 온라인 대장관리</span></div>
      <div className="ledger-empty-icon"><MonitorDown /></div>
      <p className="eyebrow">INSTALL LOCAL APP</p>
      <h1>PC에 앱을<br />설치해 주세요.</h1>
      <p>설치된 앱에서만 Excel을 불러오고 주문 대장을 관리할 수 있습니다. 선택한 파일과 대장은 이 PC에만 저장됩니다.</p>
      <button className="primary-button ledger-import-button" onClick={() => void installApp()}><MonitorDown size={18} />PC에 앱 설치</button>
      {installMessage && <div className="install-guide"><CircleAlert size={16} /><span>{installMessage}</span></div>}
      <div className="local-privacy"><ShieldCheck size={16} /><span>설치 후 바탕화면 또는 시작 메뉴의 아이콘으로 실행합니다.</span></div>
    </section>
  </main>

  if (booting) return <div className="center-screen"><div className="loader" /><span>이 PC의 주문 대장을 불러오는 중입니다.</span></div>

  if (!ledger.last_upload) return <main className="ledger-empty-page">
    <section className="ledger-empty-card">
      <div className="brand"><span className="brand-mark"><img src="./abc-mart-black.svg" alt="ABC-MART" /></span><span>타사 온라인 대장관리</span></div>
      <div className="ledger-empty-icon"><FileSpreadsheet /></div>
      <p className="eyebrow">LOCAL ORDER LEDGER</p>
      <h1>오늘 데이터를<br />불러와 시작하세요.</h1>
      <p>인트라넷에서 내려받은 Excel을 선택하면 점포를 자동으로 인식하고, 주문 대장을 이 PC에만 저장합니다.</p>
      {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
      <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(event) => void importExcel(event.target.files?.[0])} />
      <button className="primary-button ledger-import-button" disabled={uploading} onClick={() => inputRef.current?.click()}><UploadCloud size={18} />{uploading ? 'Excel 확인 중…' : '오늘 데이터 불러오기'}</button>
      <div className="local-privacy"><ShieldCheck size={16} /><span>선택한 파일과 대장은 GitHub나 외부 서버로 전송되지 않습니다.</span></div>
    </section>
  </main>

  return <main className="ledger-page">
    <header className="ledger-topbar">
      <div className="brand"><span className="brand-mark"><img src="./abc-mart-black.svg" alt="ABC-MART" /></span><span>타사 온라인 대장관리</span></div>
      <div className="ledger-actions">
        <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(event) => void importExcel(event.target.files?.[0])} />
        <button className="secondary-button" onClick={resetLedger}><Trash2 size={16} />대장 초기화</button>
        <button className="secondary-button" disabled={exporting} onClick={() => void exportLedger()}><FileDown size={16} />{exporting ? '저장 중…' : '대장 Excel 저장'}</button>
        <button className="primary-button compact" disabled={uploading} onClick={() => inputRef.current?.click()}><RefreshCw size={16} />{uploading ? '확인 중…' : '오늘 데이터 불러오기'}</button>
      </div>
    </header>
    <div className="ledger-content">
      <section className="ledger-heading">
        <div><p className="eyebrow">LOCAL ORDER LEDGER</p><h1>{activeStore || '점포 선택'} 주문 대장</h1><p>최근 불러온 파일 · {ledger.last_upload.file_name} · {formatDate(ledger.last_upload.uploaded_at)}</p></div>
        {ledger.latest_store_names.length > 1 && <label className="ledger-store-select"><Store size={16} /><select value={activeStore} onChange={(event) => { setActiveStore(event.target.value); setFilter('all'); setQuery('') }}>{ledger.latest_store_names.map((store) => <option key={store}>{store}</option>)}</select></label>}
      </section>

      <section className="ledger-sync-card">
        <div><span>조회 데이터 기간</span><strong>{periodDate(ledger.last_upload.period_from)} ~ {periodDate(ledger.last_upload.period_to)}</strong></div>
        <div><span>현재 미완료</span><strong>{ledger.last_upload.summary.open.toLocaleString()}건</strong></div>
        <div><span>오늘 신규</span><strong>{ledger.last_upload.summary.new_count.toLocaleString()}건</strong></div>
        <div><span>상태 변경</span><strong>{ledger.last_upload.summary.changed_count.toLocaleString()}건</strong></div>
        <div><span>완료 전환</span><strong>{ledger.last_upload.summary.completed_count.toLocaleString()}건</strong></div>
      </section>

      {error && <div className="form-error page-error"><CircleAlert size={16} />{error}</div>}
      <section className="metrics ledger-metrics">
        <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}><div className="metric-icon dark"><ArrowDownToLine /></div><span>전체 주문</span><strong>{enriched.length}<small>건</small></strong><p>현재 미완료</p></button>
        <button className={`danger ${filter === 'shipping_delay' ? 'selected' : ''}`} onClick={() => setFilter('shipping_delay')}><div className="metric-icon red"><AlertTriangle /></div><span>출고 지연</span><strong>{counts.shipping}<small>건</small></strong><p>등록 2일 초과</p></button>
        <button className={`danger ${filter === 'settlement_delay' ? 'selected' : ''}`} onClick={() => setFilter('settlement_delay')}><div className="metric-icon amber"><Clock3 /></div><span>정산 지연</span><strong>{counts.settlement}<small>건</small></strong><p>출고 5일 초과</p></button>
        <button className={filter === 'warning' ? 'selected' : ''} onClick={() => setFilter('warning')}><div className="metric-icon green"><Clock3 /></div><span>D-DAY · 임박</span><strong>{counts.warning}<small>건</small></strong><p>처리기한 1일 이내</p></button>
      </section>

      <section className="orders-panel">
        <div className="panel-toolbar"><div><h2>{filterLabels[filter]}</h2><span>{visible.length}건</span></div><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="주문번호, 브랜드, 상품명 검색" /></div></div>
        <LedgerTable orders={visible} onHandlingChange={saveHandling} />
      </section>
      <div className="ledger-footer-note"><ShieldCheck size={14} />이 대장은 현재 브라우저의 IndexedDB에만 저장됩니다.</div>
    </div>
  </main>
}

function LedgerTable({ orders, onHandlingChange }: { orders: LedgerOrderWithSla[]; onHandlingChange: (order: LedgerOrder, patch: Partial<Pick<LedgerOrder, 'handling_status' | 'handling_memo'>>) => Promise<void> }) {
  if (!orders.length) return <div className="table-empty"><PackageCheck size={28} /><strong>조건에 맞는 주문이 없습니다.</strong><span>필터나 검색어를 변경해 보세요.</span></div>
  return <div className="table-scroll"><table className="ledger-orders-table"><thead><tr><th>기한 상태</th><th>매장 처리</th><th>처리 메모</th><th>주문번호 / 순번</th><th>브랜드 / 상품</th><th>등록일</th><th>출고일</th><th>처리기한</th><th>진행상태</th><th>발송 구분</th></tr></thead><tbody>{orders.map((order) => <tr key={`${order.store_name}-${order.order_no}-${order.line_no}`} className={order.slaLevel === 'delayed' ? 'row-delayed' : ''}><td><span className={`sla-badge ${order.slaLevel}`}>{order.slaLevel === 'delayed' && <AlertTriangle size={13} />}{order.slaLabel}</span></td><td><select className={`handling-select handling-${(order.handling_status || '미확인').replace(/\s/g, '-')}`} value={order.handling_status || '미확인'} onChange={(event) => void onHandlingChange(order, { handling_status: event.target.value as HandlingStatus })}><option>미확인</option><option>확인 중</option><option>조치 완료</option></select></td><td><input className="handling-memo" defaultValue={order.handling_memo || ''} placeholder="메모 입력" onBlur={(event) => { if (event.target.value !== (order.handling_memo || '')) void onHandlingChange(order, { handling_memo: event.target.value }) }} /></td><td><strong className="order-no">{order.order_no}</strong><small className="line-no">#{order.line_no}</small></td><td><div className="product-cell"><strong>{order.brand || '—'}</strong><span>{order.product_name} · {order.quantity}개</span></div></td><td>{formatDate(order.registered_at)}</td><td>{formatDate(order.shipped_at)}</td><td className={order.slaLevel === 'delayed' ? 'red-text' : ''}>{formatDate(order.dueAt)}</td><td><span className="status-dot" />{order.status}</td><td>{order.shipping_type || '—'}</td></tr>)}</tbody></table></div>
}

export default LedgerApp
