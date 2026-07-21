import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpRight, Check, ChevronDown, CircleAlert, Clock3, FileSpreadsheet, LayoutDashboard, LogOut, Menu, PackageCheck, RefreshCw, Search, Settings2, Store, UploadCloud, X } from 'lucide-react'
import { demoOrders } from './data/demo'
import { isSupabaseConfigured, storeEmail, supabase } from './lib/supabase'
import { formatDate, withSla } from './lib/sla'
import { loadAllStaticOrders, loadStaticManifest, loadStaticStoreOrders, type StaticManifest } from './lib/staticData'
import type { OnlineOrder, OrderWithSla, UserProfile } from './types'

type LoginMode = 'store' | 'admin'
type Filter = 'all' | 'shipping_delay' | 'settlement_delay' | 'warning' | 'complete'
type StoreOption = { store_code: string; store_name: string }

const MASTER_KEY = 'audit2026!'

const filterLabels: Record<Filter, string> = { all: '전체 예외', shipping_delay: '출고 지연', settlement_delay: '정산 지연', warning: '처리 임박', complete: '오늘 종료' }
const formatPeriodDate = (value?: string | null) => value ? value.replace(/-/g, '.') : '—'

function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [booting, setBooting] = useState(true)
  const [manifest, setManifest] = useState<StaticManifest | null>(null)

  useEffect(() => {
    if (!supabase) {
      loadStaticManifest().then((data) => { setManifest(data); setBooting(false) })
      return
    }
    const client = supabase
    client.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        const { data: userProfile } = await client.from('app_users').select('*').eq('id', data.session.user.id).single()
        if (userProfile) setProfile(userProfile as UserProfile)
      }
      setBooting(false)
    })
  }, [])

  if (booting) return <div className="center-screen"><div className="loader" /><span>주문 현황을 불러오는 중입니다</span></div>
  if (!profile) return <Login manifest={manifest} onLogin={setProfile} />
  return <Dashboard profile={profile} manifest={manifest} onLogout={async () => { await supabase?.auth.signOut(); setProfile(null) }} />
}

function Login({ manifest, onLogin }: { manifest: StaticManifest | null; onLogin: (profile: UserProfile) => void }) {
  const mode: LoginMode = 'store'
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedStoreCode, setSelectedStoreCode] = useState<string | null>(null)
  const [masterOpen, setMasterOpen] = useState(false)
  const [masterPassword, setMasterPassword] = useState('')
  const [masterError, setMasterError] = useState('')
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>(() => manifest?.stores || [...new Map(demoOrders.map((order) => [order.store_code, { store_code: order.store_code, store_name: order.store_name }])).values()].sort((a, b) => a.store_name.localeCompare(b.store_name, 'ko')))

  useEffect(() => {
    if (manifest) { setStoreOptions(manifest.stores); return }
    if (!supabase) return
    supabase.rpc('list_active_stores').then(({ data }) => {
      if (data) setStoreOptions((data as StoreOption[]).filter((store) => store.store_code && store.store_name))
    })
  }, [])

  useEffect(() => {
    const openMasterLogin = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMasterOpen(false); return }
      if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'm') return
      event.preventDefault()
      setMasterPassword('')
      setMasterError('')
      setMasterOpen(true)
    }
    window.addEventListener('keydown', openMasterLogin)
    return () => window.removeEventListener('keydown', openMasterLogin)
  }, [])

  const filteredStores = useMemo(() => {
    const needle = identity.trim().replace(/\s+/g, '').toLowerCase()
    return storeOptions.filter((store) => !needle || store.store_name.replace(/\s+/g, '').toLowerCase().includes(needle)).slice(0, 100)
  }, [identity, storeOptions])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setLoading(true)
    try {
      if (!identity.trim() || !password) throw new Error('매장명과 비밀번호를 입력해 주세요.')
      const matchedStore = storeOptions.find((store) => store.store_name === identity.trim())
      if (!matchedStore) throw new Error('아래 매장 목록에서 매장을 선택해 주세요.')
      if (!/^\d{6}$/.test(password)) throw new Error('비밀번호는 숫자 6자리로 입력해 주세요.')
      if (password !== `99${matchedStore.store_code}`) throw new Error('매장 비밀번호가 일치하지 않습니다.')
      if (!supabase) {
        await new Promise((resolve) => setTimeout(resolve, 550))
        onLogin({ id: matchedStore.store_code, role: 'store', store_code: matchedStore.store_code, display_name: matchedStore.store_name })
        return
      }
      const email = storeEmail(matchedStore.store_code)
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) throw new Error('로그인 정보를 확인해 주세요.')
      const { data: userProfile, error: profileError } = await supabase.from('app_users').select('*').eq('id', data.user.id).single()
      if (profileError || !userProfile || userProfile.role !== mode) { await supabase.auth.signOut(); throw new Error('접근 권한을 확인할 수 없습니다.') }
      onLogin(userProfile as UserProfile)
    } catch (err) { setError(err instanceof Error ? err.message : '로그인 중 오류가 발생했습니다.') }
    finally { setLoading(false) }
  }

  const submitMaster = (event: React.FormEvent) => {
    event.preventDefault()
    setMasterError('')
    if (masterPassword.trim().toLowerCase() !== MASTER_KEY.toLowerCase()) {
      setMasterError('마스터 암호가 아닙니다.')
      return
    }
    onLogin({ id: 'static-master', role: 'admin', store_code: null, display_name: '마스터' })
  }

  return <main className="login-page">
    <section className="login-story">
      <div className="brand brand-light"><span className="brand-mark"><img src="./abc-mart-black.svg" alt="" /></span><span>타사 온라인 예외관리</span></div>
      <div className="story-copy">
        <p className="eyebrow">THIRD-PARTY ONLINE</p>
        <h1>놓치는 주문 없이,<br /><em>약속된 시간</em> 안에.</h1>
        <p>매장별 타사 온라인 주문의 출고와 정산 지연을<br />하나의 화면에서 빠르게 확인하세요.</p>
      </div>
      <div className="sla-rule"><div><span>출고 처리기한</span><strong>등록 후 2일</strong></div><div className="rule-line" /><div><span>정산 처리기한</span><strong>출고 후 5일</strong></div></div>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="mobile-brand brand"><span className="brand-mark"><img src="./abc-mart-black.svg" alt="" /></span><span>타사 온라인 예외관리</span></div>
        <p className="eyebrow">WELCOME BACK</p>
        <h2>매장 조회</h2>
        <p className="login-help">우리 매장에서 처리가 막힌 타사 온라인 주문을 확인하세요.</p>
        <label>매장명 검색<div className="input-wrap"><Search size={18} /><input autoFocus value={identity} onChange={(e) => { setIdentity(e.target.value); setSelectedStoreCode(null) }} placeholder="매장명을 입력하세요" /></div></label>
        <div className="store-picker" aria-label="매장 목록">
          <div className="store-picker-head"><span>매장 목록</span><strong>{filteredStores.length}{storeOptions.length > 100 && !identity ? '+' : ''}개</strong></div>
          <div className="store-picker-list">
            {filteredStores.map((store) => <button type="button" key={store.store_code} className={selectedStoreCode === store.store_code ? 'selected' : ''} onClick={() => { setIdentity(store.store_name); setSelectedStoreCode(store.store_code); setError('') }}><Store size={15} /><span>{store.store_name}</span>{selectedStoreCode === store.store_code && <Check size={15} />}</button>)}
            {!filteredStores.length && <p>검색 결과가 없습니다.</p>}
          </div>
        </div>
        <label>비밀번호 (6자리)<div className="input-wrap"><span className="dot-icon">•••</span><input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={password} onChange={(e) => setPassword(e.target.value.replace(/\D/g, ''))} placeholder="비밀번호 6자리 입력" /></div></label>
        {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
        <button className="primary-button" disabled={loading}>{loading ? '확인 중…' : '로그인'}<ArrowUpRight size={18} /></button>
        {manifest && <p className="demo-note">{manifest.data_period?.from && manifest.data_period?.to && <>조회 데이터 기간 · {formatPeriodDate(manifest.data_period.from)} ~ {formatPeriodDate(manifest.data_period.to)}<br /></>}최종 갱신 · {formatDate(manifest.generated_at)}</p>}
      </form>
    </section>
    {masterOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMasterOpen(false) }}>
      <section className="modal master-login-modal" role="dialog" aria-modal="true" aria-labelledby="master-login-title">
        <div className="modal-head"><div><p className="eyebrow">MASTER ACCESS</p><h2 id="master-login-title">마스터 암호 입력</h2></div><button type="button" onClick={() => setMasterOpen(false)} aria-label="닫기"><X /></button></div>
        <p className="master-login-help">마스터 암호로 접속하면 전체 점포의 주문 예외 현황을 조회할 수 있습니다.</p>
        <form onSubmit={submitMaster}>
          <label>마스터 암호<div className="input-wrap"><span className="dot-icon">•••</span><input autoFocus type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} placeholder="암호 입력" /></div></label>
          {masterError && <div className="form-error"><CircleAlert size={16} />{masterError}</div>}
          <button className="primary-button">마스터 로그인<ArrowUpRight size={18} /></button>
        </form>
      </section>
    </div>}
  </main>
}

function Dashboard({ profile, manifest, onLogout }: { profile: UserProfile; manifest: StaticManifest | null; onLogout: () => void }) {
  const storeLabel = profile.display_name.replace(/\s*점포\s*$/, '')
  const [orders, setOrders] = useState<OnlineOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [slaDays, setSlaDays] = useState({ shipping: 2, settlement: 5 })
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [error, setError] = useState('')

  const loadOrders = async () => {
    setLoading(true); setError('')
    if (manifest && profile.role === 'admin') {
      try { setOrders(await loadAllStaticOrders(manifest)); setLastSync(manifest.generated_at) }
      catch { setError('전체 주문 데이터를 불러오지 못했습니다.') }
      setLoading(false); return
    }
    if (manifest && profile.store_code) {
      const store = manifest.stores.find((item) => item.store_code === profile.store_code)
      if (!store) { setError('점포 정보를 찾지 못했습니다.'); setLoading(false); return }
      try { setOrders(await loadStaticStoreOrders(store)); setLastSync(manifest.generated_at) }
      catch { setError('점포 주문 파일을 불러오지 못했습니다.') }
      setLoading(false); return
    }
    if (!supabase) {
      const scoped = profile.role === 'store' ? demoOrders.filter((o) => o.store_code === profile.store_code) : demoOrders
      setOrders(scoped); setLoading(false); return
    }
    let request = supabase.from('orders').select('*').is('archived_at', null).order('registered_at', { ascending: false })
    if (profile.role === 'store' && profile.store_code) request = request.eq('store_code', profile.store_code)
    const { data, error: fetchError } = await request
    if (fetchError) setError('주문 데이터를 불러오지 못했습니다.')
    else setOrders((data || []) as OnlineOrder[])
    setLoading(false)
  }
  useEffect(() => { void loadOrders() }, [profile.id])
  useEffect(() => {
    if (!supabase) return
    supabase.from('sla_policies').select('shipping_days,settlement_days').lte('effective_from', new Date().toISOString()).order('effective_from', { ascending: false }).limit(1).maybeSingle().then(({ data }) => {
      if (data) setSlaDays({ shipping: data.shipping_days, settlement: data.settlement_days })
    })
    if (profile.role === 'admin') supabase.from('sync_batches').select('completed_at').eq('status', 'completed').order('completed_at', { ascending: false }).limit(1).maybeSingle().then(({ data }) => setLastSync(data?.completed_at || null))
  }, [profile.id])

  const enriched = useMemo(() => orders.map((order) => withSla(order, new Date(), slaDays.shipping, slaDays.settlement)), [orders, slaDays])
  const visible = useMemo(() => enriched.filter((order) => {
    const matchFilter = filter === 'all' || (filter === 'warning' || filter === 'complete' ? order.slaLevel === filter : order.slaLevel === 'delayed' && order.exceptionType === filter)
    const needle = query.trim().toLowerCase()
    return matchFilter && (!needle || [order.order_no, order.store_name, order.brand, order.product_name, order.store_code].some((value) => value.toLowerCase().includes(needle)))
  }), [enriched, filter, query])
  const counts = useMemo(() => ({ shipping: enriched.filter((o) => o.slaLevel === 'delayed' && o.exceptionType === 'shipping_delay').length, settlement: enriched.filter((o) => o.slaLevel === 'delayed' && o.exceptionType === 'settlement_delay').length, warning: enriched.filter((o) => o.slaLevel === 'warning').length, complete: enriched.filter((o) => o.slaLevel === 'complete').length }), [enriched])

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark"><img src="./abc-mart-black.svg" alt="" /></span><span>타사 온라인 예외관리</span></div>
      <nav><p>WORKSPACE</p><button className="active"><LayoutDashboard size={19} />주문 현황</button>{profile.role === 'admin' && !manifest && <><button onClick={() => setUploadOpen(true)}><FileSpreadsheet size={19} />엑셀 동기화</button><button onClick={() => setSettingsOpen(true)}><Settings2 size={19} />처리기한 설정</button></>}</nav>
      <div className="sidebar-bottom"><div className="sla-mini"><Clock3 size={17} /><div><span>처리기한 기준</span><strong>등록 후 {slaDays.shipping}일 · 출고 후 {slaDays.settlement}일</strong></div></div><button className="logout" onClick={onLogout}><LogOut size={17} />로그아웃</button></div>
    </aside>
    {mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="메뉴 닫기" />}
    <main className="dashboard">
      <header className="topbar"><button className="menu-button" onClick={() => setMobileNav(true)}><Menu /></button><div><span className="location-label">현재 조회 매장</span><strong>{profile.role === 'admin' ? '전체 매장' : storeLabel} <ChevronDown size={15} /></strong></div><div className="profile-chip"><span>{profile.role === 'admin' ? profile.display_name.slice(0, 1) : storeLabel.slice(0, 1)}</span><div><strong>{profile.role === 'admin' ? profile.display_name : storeLabel}</strong><small>{profile.role === 'admin' ? 'Administrator' : '매장'}</small></div></div></header>
      <div className="content">
        <section className="page-heading"><div><p className="eyebrow">ORDER EXCEPTIONS</p><h1>타사 온라인 주문 현황</h1><p>{profile.role === 'admin' ? `전체 매장의 처리 지연 건을 우선 확인하세요.${lastSync ? ` · 마지막 동기화 ${formatDate(lastSync)}` : ''}` : `${storeLabel}의 처리가 필요한 주문을 확인하세요.`}</p></div><div className="heading-actions"><button className="secondary-button" onClick={loadOrders}><RefreshCw size={16} />새로고침</button>{profile.role === 'admin' && !manifest && <button className="primary-button compact" onClick={() => setUploadOpen(true)}><UploadCloud size={17} />엑셀 업로드</button>}</div></section>
        {manifest && <div className="demo-banner"><Check size={17} /><span><strong>{profile.role === 'admin' ? '마스터 전체 데이터로 조회 중입니다.' : '점포 전용 데이터로 조회 중입니다.'}</strong> 마지막 갱신 {formatDate(manifest.generated_at)}</span></div>}
        {!manifest && !isSupabaseConfigured && <div className="demo-banner"><CircleAlert size={17} /><span><strong>데모 데이터로 표시 중입니다.</strong></span></div>}
        {error && <div className="form-error page-error"><CircleAlert size={16} />{error}</div>}
        <section className="metrics">
          <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}><div className="metric-icon dark"><ArrowDownToLine /></div><span>전체 주문</span><strong>{enriched.length}<small>건</small></strong><p>현재 조회 주문</p></button>
          <button className={`danger ${filter === 'shipping_delay' ? 'selected' : ''}`} onClick={() => setFilter('shipping_delay')}><div className="metric-icon red"><AlertTriangle /></div><span>출고 지연</span><strong>{counts.shipping}<small>건</small></strong><p>등록 2일 초과</p></button>
          <button className={`danger ${filter === 'settlement_delay' ? 'selected' : ''}`} onClick={() => setFilter('settlement_delay')}><div className="metric-icon amber"><Clock3 /></div><span>정산 지연</span><strong>{counts.settlement}<small>건</small></strong><p>출고 5일 초과</p></button>
          <button className={filter === 'warning' ? 'selected' : ''} onClick={() => setFilter('warning')}><div className="metric-icon green"><Clock3 /></div><span>처리 임박</span><strong>{counts.warning}<small>건</small></strong><p>기한 1일 이내</p></button>
        </section>
        <section className="orders-panel">
          <div className="panel-toolbar"><div><h2>{filterLabels[filter]}</h2><span>{visible.length}건</span></div><div className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="주문번호, 브랜드, 상품명 검색" /></div></div>
          <OrderTable orders={visible} loading={loading} showStore={profile.role === 'admin'} />
        </section>
      </div>
    </main>
    {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} onComplete={loadOrders} />}
    {settingsOpen && <SlaSettingsModal initial={slaDays} onClose={() => setSettingsOpen(false)} onSaved={(value) => { setSlaDays(value); setSettingsOpen(false); void loadOrders() }} />}
  </div>
}

function SlaSettingsModal({ initial, onClose, onSaved }: { initial: { shipping: number; settlement: number }; onClose: () => void; onSaved: (value: { shipping: number; settlement: number }) => void }) {
  const [shipping, setShipping] = useState(initial.shipping)
  const [settlement, setSettlement] = useState(initial.settlement)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    if (shipping < 1 || settlement < 1 || shipping > 30 || settlement > 30) { setError('처리기한은 1~30일로 입력해 주세요.'); return }
    setSaving(true); setError('')
    if (supabase) {
      const { error: saveError } = await supabase.rpc('set_sla_policy', { p_shipping_days: shipping, p_settlement_days: settlement })
      if (saveError) { setError('처리기한을 저장하지 못했습니다.'); setSaving(false); return }
    } else await new Promise((resolve) => setTimeout(resolve, 450))
    onSaved({ shipping, settlement })
  }
  return <div className="modal-backdrop"><section className="modal settings-modal" role="dialog" aria-modal="true"><div className="modal-head"><div><p className="eyebrow">PROCESS DEADLINE</p><h2>처리기한 설정</h2></div><button onClick={onClose} aria-label="닫기"><X /></button></div><p className="settings-help">새 기준은 저장 시점부터 적용되며, 이전 기준은 이력으로 보존됩니다.</p><div className="settings-fields"><label><span>등록 → 출고</span><div><input type="number" min="1" max="30" value={shipping} onChange={(e) => setShipping(Number(e.target.value))} /><strong>일 초과</strong></div><small>초과 시 출고지연으로 분류</small></label><label><span>출고 → 정산</span><div><input type="number" min="1" max="30" value={settlement} onChange={(e) => setSettlement(Number(e.target.value))} /><strong>일 초과</strong></div><small>초과 시 정산지연으로 분류</small></label></div>{error && <div className="form-error"><CircleAlert size={16} />{error}</div>}<div className="modal-actions"><button className="secondary-button" onClick={onClose}>취소</button><button className="primary-button compact" disabled={saving} onClick={save}>{saving ? '저장 중…' : '기준 저장'}</button></div></section></div>
}

function OrderTable({ orders, loading, showStore }: { orders: OrderWithSla[]; loading: boolean; showStore: boolean }) {
  if (loading) return <div className="table-empty"><div className="loader" />주문을 불러오는 중입니다.</div>
  if (!orders.length) return <div className="table-empty"><PackageCheck size={28} /><strong>조건에 맞는 주문이 없습니다.</strong><span>검색어나 필터를 변경해 보세요.</span></div>
  return <div className="table-scroll"><table><thead><tr><th>처리 상태</th><th>주문번호 / 순번</th>{showStore && <th>매장</th>}<th>브랜드 / 상품</th><th>등록일</th><th>출고일</th><th>처리 기한</th><th>진행상태</th></tr></thead><tbody>{orders.map((order) => <tr key={`${order.order_no}-${order.line_no}`} className={order.slaLevel === 'delayed' ? 'row-delayed' : ''}><td><span className={`sla-badge ${order.slaLevel}`}>{order.slaLevel === 'delayed' && <AlertTriangle size={13} />}{order.slaLabel}</span></td><td><strong className="order-no">{order.order_no}</strong><small className="line-no">#{order.line_no}</small></td>{showStore && <td><span className="store-code">{order.store_name}</span></td>}<td><div className="product-cell"><strong>{order.brand || '—'}</strong><span>{order.product_name} · {order.quantity}개</span></div></td><td>{formatDate(order.registered_at)}</td><td>{formatDate(order.shipped_at)}</td><td className={order.slaLevel === 'delayed' ? 'red-text' : ''}>{formatDate(order.dueAt)}</td><td><span className="status-dot" />{order.status}</td></tr>)}</tbody></table></div>
}

function UploadModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<OnlineOrder[]>([])
  const [state, setState] = useState<'idle' | 'reading' | 'ready' | 'syncing' | 'done'>('idle')
  const [message, setMessage] = useState('')

  const selectFile = async (selected?: File) => {
    if (!selected) return
    if (!/\.(xlsx|xls)$/i.test(selected.name)) { setMessage('xlsx 또는 xls 파일만 업로드할 수 있습니다.'); return }
    setFile(selected); setState('reading'); setMessage('')
    try { const { parseOrderExcel } = await import('./lib/excel'); const parsed = await parseOrderExcel(selected); setPreview(parsed); setState('ready') }
    catch (err) { setState('idle'); setMessage(err instanceof Error ? err.message : '파일을 읽지 못했습니다.') }
  }
  const sync = async () => {
    setState('syncing'); setMessage('')
    let batchId: string | null = null
    try {
      if (supabase) {
        const { data: masterStores, error: masterError } = await supabase.from('stores').select('store_code,store_name').eq('is_active', true)
        if (masterError) throw new Error('점포마스터를 불러오지 못했습니다.')
        const masterByName = new Map((masterStores || []).map((store) => [store.store_name.normalize('NFKC').replace(/\s+/g, '').toLowerCase(), store]))
        const unmatched = [...new Set(preview.filter((order) => !masterByName.has(order.store_name.normalize('NFKC').replace(/\s+/g, '').toLowerCase())).map((order) => order.store_name))]
        if (unmatched.length) throw new Error(`점포마스터 미매칭: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? ` 외 ${unmatched.length - 5}개` : ''}`)
        const resolvedOrders = preview.map((order) => ({ ...order, store_code: masterByName.get(order.store_name.normalize('NFKC').replace(/\s+/g, '').toLowerCase())!.store_code }))
        const hashBuffer = await crypto.subtle.digest('SHA-256', await file!.arrayBuffer())
        const fileHash = [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
        const { data: batch, error: batchError } = await supabase.from('sync_batches').insert({ file_name: file!.name, file_hash: fileHash, total_rows: preview.length, scope: 'nationwide' }).select('id').single()
        if (batchError) throw batchError
        batchId = batch.id
        for (let i = 0; i < resolvedOrders.length; i += 500) {
          const rows = resolvedOrders.slice(i, i + 500).map((order) => ({ ...order, last_seen_batch_id: batchId }))
          const { error } = await supabase.from('orders').upsert(rows, { onConflict: 'source_system,order_no,line_no' })
          if (error) throw error
        }
        const { error: engineError } = await supabase.rpc('refresh_order_exceptions')
        if (engineError) throw engineError
        await supabase.from('sync_batches').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', batchId)
      } else await new Promise((resolve) => setTimeout(resolve, 850))
      setState('done'); await onComplete()
    } catch (error) {
      if (supabase && batchId) await supabase.from('sync_batches').update({ status: 'failed', completed_at: new Date().toISOString(), error_message: 'client sync failed' }).eq('id', batchId)
      setState('ready'); setMessage(error instanceof Error ? error.message : '동기화에 실패했습니다. 권한과 데이터 형식을 확인해 주세요.')
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="upload-title"><div className="modal-head"><div><p className="eyebrow">ADMIN TOOL</p><h2 id="upload-title">엑셀 주문 동기화</h2></div><button onClick={onClose} aria-label="닫기"><X /></button></div>
    {state === 'done' ? <div className="upload-success"><span><Check /></span><h3>동기화가 완료되었습니다</h3><p><strong>{preview.length}건</strong>의 주문이 주문번호 기준으로 반영되었습니다.</p><button className="primary-button" onClick={onClose}>주문 현황 확인</button></div> : <>
      <button className={`drop-zone ${file ? 'has-file' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void selectFile(e.dataTransfer.files[0]) }}>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => void selectFile(e.target.files?.[0])} />
        <span className="upload-icon"><FileSpreadsheet /></span>{file ? <><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(1)} KB · {preview.length || '—'}건 확인</small></> : <><strong>엑셀 파일을 여기에 놓으세요</strong><small>또는 클릭하여 파일 선택 · XLSX, XLS</small></>}
      </button>
      <div className="column-guide"><strong>필수 열</strong><span>매장명(C열)</span><span>등록일자</span><span>진행상태</span><span>주문번호(비고)</span><small>B열 F는 원본 구분값, F열은 판매구분으로 별도 보존합니다.</small></div>
      {message && <div className="form-error"><CircleAlert size={16} />{message}</div>}
      {preview.length > 0 && <div className="preview-summary"><div><strong>{preview.length}</strong><span>읽은 주문</span></div><div><strong>{new Set(preview.map((o) => o.store_code)).size}</strong><span>대상 매장</span></div><p>같은 주문번호는 최신 엑셀 값으로 업데이트됩니다.</p></div>}
      <div className="modal-actions"><button className="secondary-button" onClick={onClose}>취소</button><button className="primary-button compact" disabled={state !== 'ready'} onClick={sync}>{state === 'reading' ? '파일 확인 중…' : state === 'syncing' ? '동기화 중…' : <><RefreshCw size={16} />{preview.length}건 동기화</>}</button></div>
    </>}
  </section></div>
}

export default App
