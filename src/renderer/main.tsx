import '@vitejs/plugin-react/preamble'
import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppSettings, BackupCandidate, CategorySummary, DashboardSummary, ProductDraft, ProductListQuery, ProductSummary, SessionView, StockActorOption, StockMovementQuery, StockMovementSummary, UserSummary } from '../shared/contracts'
import { localDateRangeToUtc } from '../shared/domain/inventory'
import './style.css'

const initialQuery: ProductListQuery = { search: '', categoryId: null, status: 'ACTIVE', stockFilter: 'ALL', sortKey: 'name', direction: 'asc', page: 1, pageSize: 50 }
const blankProduct: ProductDraft = { sku: '', name: '', categoryId: null, unit: '個', reorderLevel: 0, note: null }
type Tab = 'dashboard' | 'products' | 'stock' | 'history' | 'categories' | 'users' | 'settings' | 'data'
const initialMovementQuery: StockMovementQuery = { productId: null, startAt: null, endAt: null, type: null, actorUserId: null, page: 1, pageSize: 50 }
const reasonLabels = { DELIVERY: '入荷', RETURN: '返品', DAMAGE: '破損', EXPIRED: '期限切れ', STOCKTAKE: '棚卸差異', OTHER: 'その他' } as const

function App(): React.JSX.Element {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [recoveryRequired, setRecoveryRequired] = useState(false)
  const [session, setSession] = useState<SessionView | null>(null)
  const [error, setError] = useState('')
  const [resetMode, setResetMode] = useState(false)
  const [notice, setNotice] = useState('')
  const [issuedCode, setIssuedCode] = useState('')
  const [tab, setTab] = useState<Tab>('dashboard')
  const [users, setUsers] = useState<UserSummary[]>([])
  const [categories, setCategories] = useState<CategorySummary[]>([])
  const [products, setProducts] = useState<ProductSummary[]>([])
  const [productTotal, setProductTotal] = useState(0)
  const [query, setQuery] = useState<ProductListQuery>(initialQuery)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [productFormOpen, setProductFormOpen] = useState(false)
  const [editProductId, setEditProductId] = useState<string | null>(null)
  const [productDraft, setProductDraft] = useState<ProductDraft>(blankProduct)
  const [passwordFormOpen, setPasswordFormOpen] = useState(false)
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null)
  const [movementRows, setMovementRows] = useState<StockMovementSummary[]>([])
  const [movementTotal, setMovementTotal] = useState(0)
  const [movementQuery, setMovementQuery] = useState<StockMovementQuery>(initialMovementQuery)
  const [movementActors, setMovementActors] = useState<StockActorOption[]>([])
  const [historyProduct, setHistoryProduct] = useState('')
  const [historyProductSearch, setHistoryProductSearch] = useState('')
  const [historyProducts, setHistoryProducts] = useState<ProductSummary[]>([])
  const [historyStartDate, setHistoryStartDate] = useState('')
  const [historyEndDate, setHistoryEndDate] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [stockProductId, setStockProductId] = useState('')
  const [stockType, setStockType] = useState<'RECEIPT' | 'ISSUE' | 'ADJUSTMENT'>('RECEIPT')
  const [savingStock, setSavingStock] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [restoreCandidate, setRestoreCandidate] = useState<BackupCandidate | null>(null)

  const refresh = useCallback(async () => {
    const setup = await window.storeApp.setup.isRequired()
    if (!setup.ok) { setError(setup.error.message); setRecoveryRequired(setup.error.code === 'RECOVERY_REQUIRED'); setSetupRequired(false); return }
    setRecoveryRequired(false); setSetupRequired(setup.value)
    if (!setup.value) {
      const result = await window.storeApp.auth.getSession()
      if (result.ok) setSession((old) => old?.state === result.value?.state && old?.user.id === result.value?.user.id && old?.user.displayName === result.value?.user.displayName && old?.user.role === result.value?.user.role && old?.expiresAt === result.value?.expiresAt ? old : result.value)
    }
  }, [])
  const refreshUsers = useCallback(async () => {
    const result = await window.storeApp.users.list()
    if (result.ok) setUsers(result.value)
  }, [])
  const refreshCategories = useCallback(async () => {
    const result = await window.storeApp.categories.list(true)
    if (result.ok) setCategories(result.value); else setError(result.error.message)
  }, [])
  const refreshProducts = useCallback(async (nextQuery = query) => {
    if (!session || session.state !== 'AUTHENTICATED') return
    setLoadingProducts(true)
    const result = await window.storeApp.products.list(nextQuery)
    if (result.ok) { setProducts([...result.value.items]); setProductTotal(result.value.total) }
    else setError(result.error.message)
    setLoadingProducts(false)
  }, [query, session])
  const refreshDashboard = useCallback(async () => {
    const result = await window.storeApp.stock.getDashboard()
    if (result.ok) setDashboard(result.value); else setError(result.error.message)
  }, [])
  const refreshMovementActors = useCallback(async () => {
    const result = await window.storeApp.stock.listActors()
    if (result.ok) setMovementActors([...result.value]); else setError(result.error.message)
  }, [])
  const refreshMovements = useCallback(async (nextQuery = movementQuery) => {
    setHistoryLoading(true)
    const result = await window.storeApp.stock.list(nextQuery)
    if (result.ok) { setMovementRows([...result.value.items]); setMovementTotal(result.value.total) }
    else setError(result.error.message)
    setHistoryLoading(false)
  }, [movementQuery])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Polling synchronizes session state through asynchronous IPC.
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 1000); return () => window.clearInterval(timer) }, [refresh])
  useEffect(() => {
    if (session?.state !== 'AUTHENTICATED') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Shared IPC loaders also manage the loading indicator for query changes.
    if (session.user.role === 'ADMIN') void refreshUsers()
    void refreshCategories()
    void refreshProducts(query)
  }, [session?.state, session?.user.id, session?.user.role, query, refreshUsers, refreshCategories, refreshProducts])
  useEffect(() => {
    if (session?.state !== 'AUTHENTICATED') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Dashboard state is populated by asynchronous IPC responses.
    void refreshDashboard()
    void refreshMovementActors()
  }, [session?.state, session?.user.id, refreshDashboard, refreshMovementActors])
  useEffect(() => {
    if (tab !== 'settings' || session?.user.role !== 'ADMIN') return
    void window.storeApp.settings.get().then((r) => { if (r.ok) setSettings(r.value); else setError(r.error.message) })
  }, [tab, session?.user.role])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Shared IPC history loading preserves the query loading indicator.
    if (session?.state === 'AUTHENTICATED' && tab === 'history') void refreshMovements(movementQuery)
  }, [session?.state, session?.user.id, tab, movementQuery, refreshMovements])

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>, action: (form: FormData) => Promise<void>) => {
    event.preventDefault(); setError(''); setNotice('')
    const form = event.currentTarget
    await action(new FormData(form))
    form.querySelectorAll<HTMLInputElement>('input[type="password"], input[name="code"]').forEach((input) => { input.value = '' })
  }
  const showError = (result: { ok: boolean; error?: { message: string } }) => { if (!result.ok) setError(result.error?.message ?? '処理を完了できませんでした。') }
  const logout = () => { setIssuedCode(''); setSession(null); void window.storeApp.auth.logout() }
  const startProductCreate = () => { setEditProductId(null); setProductDraft(blankProduct); setProductFormOpen(true); setError('') }
  const startProductEdit = (product: ProductSummary) => {
    setEditProductId(product.id)
    setProductDraft({ sku: product.sku, name: product.name, categoryId: product.categoryId, unit: product.unit, reorderLevel: product.reorderLevel, note: product.note })
    setProductFormOpen(true); setError('')
  }
  const saveProduct = async (form: FormData) => {
    const draft: ProductDraft = {
      sku: String(form.get('sku') ?? ''), name: String(form.get('name') ?? ''), categoryId: String(form.get('categoryId') ?? '') || null,
      unit: String(form.get('unit') ?? ''), reorderLevel: Number(form.get('reorderLevel') ?? 0), note: String(form.get('note') ?? '') || null
    }
    const result = editProductId
      ? await window.storeApp.products.update({ ...draft, productId: editProductId })
      : await window.storeApp.products.create({ ...draft, initialStock: Number(form.get('initialStock') ?? 0) })
    if (!result.ok) { showError(result); return }
    setProductFormOpen(false); setNotice(editProductId ? '商品を更新しました。' : '商品を登録しました。')
    await refreshProducts()
  }
  const updateQuery = (patch: Partial<ProductListQuery>) => setQuery((old) => ({ ...old, ...patch, page: 1 }))
  const openStock = (product: ProductSummary) => { setStockProductId(product.id); setStockType('RECEIPT'); setTab('stock'); setError(''); setNotice('') }
  const openProductHistory = (product: ProductSummary) => {
    setHistoryProducts((items) => items.some((item) => item.id === product.id) ? items : [...items, product])
    setHistoryProduct(product.id); setMovementQuery({ ...initialMovementQuery, productId: product.id }); setTab('history'); setError('')
  }
  const searchHistoryProducts = async () => {
    const result = await window.storeApp.products.list({ ...initialQuery, search: historyProductSearch.trim(), status: 'ALL', pageSize: 200 })
    if (result.ok) setHistoryProducts([...result.value.items]); else showError(result)
  }
  const applyHistoryFilters = () => {
    try {
      const dates = localDateRangeToUtc(historyStartDate, historyEndDate)
      setMovementQuery({ ...movementQuery, productId: historyProduct || null, ...dates, page: 1 })
      setError('')
    } catch { setError('日付範囲を確認してください。') }
  }
  const recordStock = async (form: FormData) => {
    if (savingStock) return
    setSavingStock(true); setError(''); setNotice('')
    const type = stockType
    const common = { productId: String(form.get('productId') ?? ''), reasonCode: String(form.get('reasonCode') ?? 'OTHER') as 'DELIVERY' | 'RETURN' | 'DAMAGE' | 'EXPIRED' | 'STOCKTAKE' | 'OTHER', note: String(form.get('note') ?? '') || null }
    try {
      const result = await window.storeApp.stock.record(type === 'ADJUSTMENT'
        ? { ...common, type, countedStock: Number(form.get('countedStock')) }
        : { ...common, type, quantity: Number(form.get('quantity')) })
      if (!result.ok) { showError(result); return }
      setStockProductId(result.value.movement.productId)
      setNotice(`在庫を記録しました。変更前 ${result.value.movement.stockBefore} → 変更後 ${result.value.currentStock}（差分 ${result.value.movement.quantityDelta}）`)
      await Promise.all([refreshProducts(), refreshDashboard(), refreshMovements(), refreshMovementActors()])
    } catch {
      setError('結果を確認できませんでした。二重記録を避けるため再送せず、最新の在庫と履歴を再読み込みしてください。')
      await Promise.all([refreshProducts(), refreshDashboard(), refreshMovements(), refreshMovementActors()])
    } finally { setSavingStock(false) }
  }

  if (setupRequired === null) return <main className="shell"><p role="status">起動しています…</p></main>
  if (recoveryRequired) return <main className="shell"><section className="card"><h1>管理者による復旧が必要です</h1><p className="error" role="alert">{error}</p><p>通常の初期セットアップから権限を再作成することはできません。データベースを保持し、管理者復旧手順を確認してください。</p></section></main>
  if (setupRequired) return <main className="shell"><section className="card"><h1>初期セットアップ</h1><p>店舗と最初の管理者を登録します。</p>
    <form onSubmit={(e) => void onSubmit(e, async (f) => {
      const result = await window.storeApp.setup.createInitialAdmin({ storeName: String(f.get('storeName') ?? ''), displayName: String(f.get('displayName') ?? ''), loginName: String(f.get('loginName') ?? ''), password: String(f.get('password') ?? ''), confirmPassword: String(f.get('confirmPassword') ?? '') })
      if (result.ok) setSession(result.value); else showError(result)
    })}>
      <label>店舗名<input name="storeName" required maxLength={100} /></label><label>管理者表示名<input name="displayName" required maxLength={100} /></label><label>ログインID<input name="loginName" required maxLength={64} autoComplete="username" /></label><label>パスワード（4〜128文字）<input name="password" required type="password" autoComplete="new-password" /></label><label>パスワード（確認）<input name="confirmPassword" required type="password" autoComplete="new-password" /></label>
      <p className="hint">DEMO版では新しく設定するパスワードを4〜128 Unicodeコードポイントで設定できます。</p>
      <button>初期設定を完了</button>
    </form>{error && <p className="error" role="alert">{error}</p>}</section></main>

  if (!session) return <main className="shell"><section className="card"><h1>沖縄店舗在庫管理（DEMO版）</h1><p>{resetMode ? '再設定コードを入力してください。' : 'ログインしてください。'}</p>
    {!resetMode ? <form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.login({ loginName: String(f.get('loginName') ?? ''), password: String(f.get('password') ?? '') }); if (r.ok) setSession(r.value); else showError(r) })}><label>ログインID<input name="loginName" required autoComplete="username" /></label><label>パスワード<input name="password" required type="password" autoComplete="current-password" /></label><button>ログイン</button></form> : <form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.beginPasswordReset({ loginName: String(f.get('loginName') ?? ''), code: String(f.get('code') ?? '') }); if (r.ok) setSession(r.value); else showError(r) })}><label>ログインID<input name="loginName" required autoComplete="username" /></label><label>再設定コード<input name="code" required autoComplete="one-time-code" /></label><button>コードを確認</button></form>}
    <button className="link" onClick={() => { setResetMode(!resetMode); setError('') }}>{resetMode ? 'ログインに戻る' : '再設定コードを使う'}</button>{notice && <p className="notice" role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</section></main>

  if (session.state === 'LOCKED') return <main className="shell"><section className="card"><h1>画面をロックしました</h1><p>{session.user.displayName} さん。続行するにはパスワードを入力してください。</p><form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.unlock(String(f.get('password') ?? '')); if (r.ok) setSession(r.value); else showError(r) })}><label>パスワード<input name="password" autoFocus required type="password" autoComplete="current-password" /></label><button>ロックを解除</button></form><button className="link" onClick={logout}>ログアウト</button>{error && <p role="alert" className="error">{error}</p>}</section></main>

  if (session.state === 'PASSWORD_RESET_REQUIRED') return <main className="shell"><section className="card"><h1>新しいパスワード</h1><p>本人確認が完了しました。新しいパスワードを設定してください。</p><form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.completePasswordReset({ password: String(f.get('password') ?? ''), confirmPassword: String(f.get('confirmPassword') ?? '') }); if (r.ok) { setResetMode(false); setSession(null); setNotice('パスワードを設定しました。ログインしてください。') } else showError(r) })}><label>新しいパスワード（4〜128文字）<input name="password" required type="password" autoComplete="new-password" /></label><label>確認入力<input name="confirmPassword" required type="password" autoComplete="new-password" /></label><p className="hint">DEMO版では新しく設定するパスワードを4〜128 Unicodeコードポイントで設定できます。</p><button>パスワードを設定</button></form><button className="link" onClick={() => { logout(); setResetMode(false) }}>キャンセル</button>{error && <p className="error" role="alert">{error}</p>}</section></main>

  return <main className="shell wide"><header className="topbar"><div><strong>{session.storeName}</strong><span>店舗在庫管理</span></div><div>{session.user.displayName}（{session.user.role}） <button className="secondary" onClick={logout}>ログアウト</button></div></header>
    <nav className="tabs" aria-label="管理画面">{(['dashboard', 'products', 'stock', 'history', 'categories', ...(session.user.role === 'ADMIN' ? ['users', 'settings', 'data'] : [])] as Tab[]).map((item) => <button key={item} className={tab === item ? 'selected' : 'secondary'} onClick={() => { setTab(item); setError(''); setNotice('') }}>{item === 'dashboard' ? 'ダッシュボード' : item === 'products' ? '商品一覧' : item === 'stock' ? '在庫変更' : item === 'history' ? '在庫履歴' : item === 'categories' ? 'カテゴリ管理' : item === 'users' ? 'ユーザー管理' : item === 'settings' ? '設定' : 'バックアップ・復元'}</button>)}</nav>
    <section className="card">
      {tab === 'dashboard' && <section><header className="section-heading"><div><h1>ダッシュボード</h1><p>登録商品は全件、有効商品数と在庫警告は有効商品のみを集計しています。</p></div></header>{dashboard ? <><div className="stats"><article><span>登録商品数（無効含む）</span><strong>{dashboard.registeredProductCount}</strong></article><article><span>有効商品数</span><strong>{dashboard.activeProductCount}</strong></article><button className="stat-button" onClick={() => { updateQuery({ stockFilter: 'LOW' }); setTab('products') }}><span>低在庫商品</span><strong>{dashboard.lowStockProductCount}</strong></button><button className="stat-button" onClick={() => { updateQuery({ stockFilter: 'ZERO' }); setTab('products') }}><span>在庫0商品</span><strong>{dashboard.zeroStockProductCount}</strong></button></div><h2>直近の在庫変更（最大10件）</h2>{dashboard.recentMovements.length ? <MovementTable items={[...dashboard.recentMovements]} onHistory={(m) => { setHistoryProduct(m.productId); setMovementQuery({ ...initialMovementQuery, productId: m.productId }); setTab('history') }} /> : <p className="empty">在庫変更の記録はありません。</p>}</> : <p role="status">集計を読み込んでいます…</p>}</section>}
      {tab === 'products' && <section><header className="section-heading"><div><h1>商品一覧</h1><p>登録商品数: {productTotal}</p></div><div className="actions">{session.user.role === 'ADMIN' && <button onClick={startProductCreate}>商品を登録</button>}<button className="secondary" onClick={async () => { const r = await window.storeApp.data.exportProducts(query); if (r.ok) setNotice(r.value.cancelled ? 'CSV出力をキャンセルしました。' : `${r.value.count ?? 0}件をCSVへ出力しました。`); else showError(r) }}>条件一致をCSV出力</button></div></header>
        <div className="filters"><label>SKU・商品名検索<input value={query.search} onChange={(e) => updateQuery({ search: e.target.value })} maxLength={200} placeholder="検索語" /></label><label>カテゴリ<select value={query.categoryId ?? ''} onChange={(e) => updateQuery({ categoryId: e.target.value || null })}><option value="">すべて</option>{categories.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>状態<select value={query.status} onChange={(e) => updateQuery({ status: e.target.value as ProductListQuery['status'] })}><option value="ACTIVE">有効</option><option value="INACTIVE">無効</option><option value="ALL">すべて</option></select></label><label>並び順<select value={query.sortKey} onChange={(e) => updateQuery({ sortKey: e.target.value as ProductListQuery['sortKey'] })}><option value="name">商品名</option><option value="sku">SKU</option><option value="currentStock">現在庫</option><option value="reorderLevel">最低在庫</option></select></label><label>方向<select value={query.direction} onChange={(e) => updateQuery({ direction: e.target.value as ProductListQuery['direction'] })}><option value="asc">昇順</option><option value="desc">降順</option></select></label><label>在庫条件<select value={query.stockFilter} onChange={(e) => updateQuery({ stockFilter: e.target.value as ProductListQuery['stockFilter'] })}><option value="ALL">すべて</option><option value="LOW">低在庫</option><option value="ZERO">在庫0</option></select></label></div>
        {productFormOpen && session.user.role === 'ADMIN' && <form className="editor" onSubmit={(e) => void onSubmit(e, saveProduct)}><h2>{editProductId ? '商品を編集' : '商品を登録'}</h2><div className="form-grid"><label>SKU<input name="sku" required maxLength={64} pattern="[A-Za-z0-9_-]+" value={productDraft.sku} onChange={(e) => setProductDraft({ ...productDraft, sku: e.target.value })} /></label><label>商品名<input name="name" required maxLength={200} value={productDraft.name} onChange={(e) => setProductDraft({ ...productDraft, name: e.target.value })} /></label><label>カテゴリ<select name="categoryId" value={productDraft.categoryId ?? ''} onChange={(e) => setProductDraft({ ...productDraft, categoryId: e.target.value || null })}><option value="">未分類</option>{categories.filter((c) => c.isActive || (editProductId && c.id === productDraft.categoryId)).map((c) => <option key={c.id} value={c.id}>{c.name}{c.isActive ? '' : '（無効・既存）'}</option>)}</select></label><label>単位<input name="unit" required maxLength={16} value={productDraft.unit} onChange={(e) => setProductDraft({ ...productDraft, unit: e.target.value })} /></label><label>最低在庫数<input name="reorderLevel" type="number" required min={0} max={2147483647} value={productDraft.reorderLevel} onChange={(e) => setProductDraft({ ...productDraft, reorderLevel: Number(e.target.value) })} /></label>{!editProductId && <label>初期在庫数<input name="initialStock" type="number" required min={0} max={2147483647} step={1} defaultValue={0} /></label>}<label>メモ<textarea name="note" maxLength={2000} value={productDraft.note ?? ''} onChange={(e) => setProductDraft({ ...productDraft, note: e.target.value || null })} /></label></div><p className="hint">初期在庫は新規登録時だけ設定できます。登録後の調整は在庫変更から行ってください。</p><div className="actions"><button>{editProductId ? '変更を保存' : '登録'}</button><button type="button" className="secondary" onClick={() => setProductFormOpen(false)}>キャンセル</button></div></form>}
        {loadingProducts ? <p role="status">商品を読み込んでいます…</p> : products.length === 0 ? <p className="empty">条件に一致する商品はありません。</p> : <div className="table-wrap"><table><thead><tr><th>SKU</th><th>商品名</th><th>カテゴリ</th><th>在庫</th><th>在庫状態</th><th>最低在庫</th><th>単位</th><th>状態</th><th>操作</th></tr></thead><tbody>{products.map((p) => <tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{p.categoryName ?? '未分類'}{p.categoryActive === false && <small>（無効カテゴリ）</small>}</td><td>{p.currentStock}</td><td>{p.currentStock === 0 ? `在庫0${p.reorderLevel > 0 ? '・低在庫' : ''}` : p.reorderLevel > 0 && p.currentStock <= p.reorderLevel ? '低在庫' : '通常'}</td><td>{p.reorderLevel}</td><td>{p.unit}</td><td>{p.isActive ? '有効' : '無効'}</td><td><button className="small secondary" disabled={!p.isActive} onClick={() => openStock(p)}>在庫変更</button><button className="small secondary" onClick={() => openProductHistory(p)}>履歴</button>{session.user.role === 'ADMIN' && <><button className="small secondary" onClick={() => startProductEdit(p)}>編集</button>{p.isActive && <button className="small secondary" onClick={async () => { if (!window.confirm(`「${p.name}」を無効化しますか？商品情報と履歴は保持されます。`)) return; const r = await window.storeApp.products.deactivate(p.id); if (r.ok) await refreshProducts(); else showError(r) }}>無効化</button>}</>}</td></tr>)}</tbody></table></div>}
        <div className="pager"><span>{productTotal === 0 ? 0 : (query.page - 1) * query.pageSize + 1}–{Math.min(query.page * query.pageSize, productTotal)} / {productTotal}</span><button className="secondary" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>前へ</button><span>ページ {query.page}</span><button className="secondary" disabled={query.page * query.pageSize >= productTotal} onClick={() => setQuery({ ...query, page: query.page + 1 })}>次へ</button></div>
      </section>}

      {tab === 'stock' && <section><header className="section-heading"><div><h1>在庫変更</h1><p>処理中は送信を無効にします。結果が不明な場合は再送せず在庫と履歴を確認してください。</p></div></header><form className="editor" onSubmit={(e) => void onSubmit(e, recordStock)}><div className="form-grid"><label>商品<select name="productId" value={stockProductId} onChange={(e) => setStockProductId(e.target.value)} required><option value="">商品を選択</option>{products.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}</select></label><label>操作<select value={stockType} onChange={(e) => setStockType(e.target.value as typeof stockType)}><option value="RECEIPT">入庫</option><option value="ISSUE">出庫</option><option value="ADJUSTMENT">棚卸</option></select></label>{stockType === 'ADJUSTMENT' ? <label>棚卸実数<input name="countedStock" type="number" required min={0} max={2147483647} step={1} /></label> : <label>数量<input name="quantity" type="number" required min={1} max={2147483647} step={1} /></label>}<label>理由<select key={stockType} name="reasonCode" defaultValue={stockType === 'ADJUSTMENT' ? 'STOCKTAKE' : 'OTHER'}><option value="DELIVERY">入荷</option><option value="RETURN">返品</option><option value="DAMAGE">破損</option><option value="EXPIRED">期限切れ</option><option value="STOCKTAKE">棚卸差異</option><option value="OTHER">その他</option></select></label><label>メモ<textarea name="note" maxLength={2000} /></label></div>{products.find((p) => p.id === stockProductId) && <p className="hint">画面表示の現在庫: {products.find((p) => p.id === stockProductId)!.currentStock}。記録時はMainが最新値を再取得して計算します。</p>}<div className="actions"><button disabled={savingStock}>{savingStock ? '記録中…' : '在庫を記録'}</button><button type="button" className="secondary" onClick={() => { setTab('products'); setNotice('') }}>戻る</button></div></form></section>}

      {tab === 'history' && <section><header className="section-heading"><div><h1>在庫履歴</h1><p>操作者は記録時のスナップショット、商品名とSKUは現在の商品情報を表示します。</p></div></header>
        <div className="history-product-search"><label>商品候補を検索<input value={historyProductSearch} onChange={(e) => setHistoryProductSearch(e.target.value)} placeholder="SKUまたは商品名" maxLength={200} /></label><button className="secondary" onClick={() => void searchHistoryProducts()}>候補を読み込む</button></div>
        <div className="filters history-filters"><label>商品<select value={historyProduct} onChange={(e) => setHistoryProduct(e.target.value)}><option value="">すべての商品</option>{[...products, ...historyProducts].filter((product, index, all) => all.findIndex((item) => item.id === product.id) === index).map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}{historyProduct && ![...products, ...historyProducts].some((p) => p.id === historyProduct) && <option value={historyProduct}>選択した商品</option>}</select></label>
          <label>開始日<input type="date" value={historyStartDate} onChange={(e) => setHistoryStartDate(e.target.value)} /></label><label>終了日<input type="date" value={historyEndDate} onChange={(e) => setHistoryEndDate(e.target.value)} /></label>
          <label>種別<select value={movementQuery.type ?? ''} onChange={(e) => setMovementQuery({ ...movementQuery, type: (e.target.value || null) as StockMovementQuery['type'], page: 1 })}><option value="">すべて</option><option value="OPENING">初期在庫</option><option value="RECEIPT">入庫</option><option value="ISSUE">出庫</option><option value="ADJUSTMENT">棚卸</option></select></label>
          <label>操作者<select value={movementQuery.actorUserId ?? ''} onChange={(e) => setMovementQuery({ ...movementQuery, actorUserId: e.target.value || null, page: 1 })}><option value="">すべて</option>{movementActors.map((actor) => <option key={actor.userId} value={actor.userId}>{actor.displayName}（{actor.loginName}）</option>)}</select></label><button onClick={applyHistoryFilters}>絞り込む</button></div>
        {historyLoading ? <p role="status">履歴を読み込んでいます…</p> : movementRows.length === 0 ? <p className="empty">条件に一致する履歴はありません。</p> : <MovementTable items={movementRows} />}
        <div className="pager"><span>{movementTotal === 0 ? 0 : (movementQuery.page - 1) * movementQuery.pageSize + 1}–{Math.min(movementQuery.page * movementQuery.pageSize, movementTotal)} / {movementTotal}</span><button className="secondary" disabled={movementQuery.page <= 1} onClick={() => setMovementQuery({ ...movementQuery, page: movementQuery.page - 1 })}>前へ</button><span>ページ {movementQuery.page}</span><button className="secondary" disabled={movementQuery.page * movementQuery.pageSize >= movementTotal} onClick={() => setMovementQuery({ ...movementQuery, page: movementQuery.page + 1 })}>次へ</button></div></section>}

      {tab === 'categories' && <section><header className="section-heading"><div><h1>カテゴリ管理</h1><p>カテゴリの無効化後も既存商品との関連は保持されます。</p></div></header>{session.user.role === 'ADMIN' && <form className="inline-form" onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.categories.create(String(f.get('name') ?? '')); if (r.ok) { setNotice('カテゴリを作成しました。'); await refreshCategories() } else showError(r) })}><label>カテゴリ名<input name="name" required maxLength={100} /></label><button>カテゴリを追加</button></form>}<ul className="managed-list">{categories.map((c) => <li key={c.id}><form className="inline-form" onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.categories.update({ categoryId: c.id, name: String(f.get('name') ?? '') }); if (r.ok) { setNotice('カテゴリ名を更新しました。'); await refreshCategories() } else showError(r) })}><label>カテゴリ名<input name="name" defaultValue={c.name} required maxLength={100} /></label><span className="state">{c.isActive ? '有効' : '無効'}</span>{session.user.role === 'ADMIN' && <><button className="secondary">名称を保存</button>{c.isActive && <button type="button" className="secondary" onClick={async () => { if (!window.confirm(`「${c.name}」を無効化しますか？既存商品のカテゴリ情報は保持されます。`)) return; const r = await window.storeApp.categories.deactivate(c.id); if (r.ok) await refreshCategories(); else showError(r) }}>無効化</button>}</>}</form></li>)}</ul></section>}

      {tab === 'users' && session.user.role === 'ADMIN' && <section><header className="section-heading"><div><h1>ユーザー管理</h1><p>新しい利用者は一度限りのコードで本人がパスワードを設定します。</p></div></header><form className="inline-form" onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.users.create({ loginName: String(f.get('loginName') ?? ''), displayName: String(f.get('displayName') ?? ''), role: String(f.get('role') ?? 'STAFF') as 'ADMIN' | 'STAFF' }); if (r.ok) { setIssuedCode(r.value.code); setNotice(`本人へ15分以内に伝えてください。再設定コード: ${r.value.code}`); await refreshUsers() } else showError(r) })}><label>ログインID<input name="loginName" required maxLength={64} /></label><label>表示名<input name="displayName" required maxLength={100} /></label><label>ロール<select name="role"><option>STAFF</option><option>ADMIN</option></select></label><button>ユーザー作成・コード発行</button></form><ul className="managed-list">{users.map((u) => <li key={u.id}><div className="user-heading"><strong>{u.loginName}</strong><span>{u.isActive ? '有効' : '無効'}{u.mustChangePassword ? '・初期設定待ち' : ''}</span></div><form className="inline-form" onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.users.update({ userId: u.id, displayName: String(f.get('displayName') ?? ''), role: String(f.get('role') ?? u.role) as 'ADMIN' | 'STAFF' }); if (r.ok) { setNotice('ユーザー情報を更新しました。'); await refreshUsers() } else showError(r) })}><label>表示名<input name="displayName" defaultValue={u.displayName} required maxLength={100} /></label><label>ロール<select name="role" defaultValue={u.role}><option>STAFF</option><option>ADMIN</option></select></label><button className="secondary">変更を保存</button>{u.isActive && <><button type="button" className="secondary" onClick={async () => { const r = await window.storeApp.users.issuePasswordReset(u.id); if (r.ok) { setIssuedCode(r.value.code); setNotice(`本人へ15分以内に伝えてください。再設定コード: ${r.value.code}`) } else showError(r) }}>コード再発行</button>{u.id !== session.user.id && <button type="button" className="secondary" onClick={async () => { if (!window.confirm(`「${u.displayName}」を無効化しますか？この利用者のセッションは失効します。`)) return; const r = await window.storeApp.users.deactivate(u.id); if (r.ok) await refreshUsers(); else showError(r) }}>無効化</button>}</>}</form></li>)}</ul></section>}

      {tab === 'settings' && session.user.role === 'ADMIN' && <section><h1>店舗設定</h1>{settings && <form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.settings.update({ storeName: String(f.get('storeName') ?? ''), idleLockMinutes: Number(f.get('idleLockMinutes')) }); if (r.ok) { setSettings(r.value); setNotice('設定を保存しました。ロック時間の短縮はすぐ反映されます。') } else showError(r) })}><label>店舗名<input name="storeName" defaultValue={settings.storeName} required maxLength={100} /></label><label>無操作ロック（分）<input name="idleLockMinutes" type="number" min="1" max="60" step="1" defaultValue={settings.idleLockMinutes} required /></label><p>データベース保存先（読取専用）</p><code>{settings.databasePath}</code><button>設定を保存</button></form>}</section>}
      {tab === 'data' && session.user.role === 'ADMIN' && <section><h1>バックアップ・復元</h1><p>バックアップにはユーザー情報も含まれ、暗号化されません。別媒体へ保管してください。</p><div className="actions"><button onClick={async () => { const r = await window.storeApp.data.createBackup(); if (r.ok) setNotice(r.value.cancelled ? 'バックアップをキャンセルしました。' : `バックアップを作成しました: ${r.value.path ?? ''}`); else showError(r) }}>バックアップを作成</button><button className="secondary" onClick={async () => { const r = await window.storeApp.data.inspectRestore(); if (!r.ok) showError(r); else if (!r.value.cancelled) setRestoreCandidate(r.value.candidate ?? null) }}>復元候補を検査</button></div>{restoreCandidate && <form className="editor" onSubmit={(e) => void onSubmit(e, async (f) => { if (!window.confirm(`現在のデータを置き換え、復元後に再起動します。店舗「${restoreCandidate.storeName}」のデータへ復元しますか？`)) return; const r = await window.storeApp.data.applyRestore({ candidateId: restoreCandidate.candidateId, confirmation: String(f.get('confirmation') ?? ''), password: String(f.get('password') ?? '') }); if (r.ok) setNotice('cancelled' in r.value ? '復元をキャンセルしました。' : '復元しました。アプリを再起動しています。'); else showError(r) })}><h2>候補の確認</h2><p>店舗: {restoreCandidate.storeName} / 作成: {restoreCandidate.createdAt ? new Date(restoreCandidate.createdAt).toLocaleString() : '不明'} / schema v{restoreCandidate.schemaVersion} / ユーザー {restoreCandidate.userCount} / 商品 {restoreCandidate.productCount}</p><label>確認のため店舗名を入力<input name="confirmation" required /></label><label>現在のADMINパスワード<input name="password" type="password" required autoComplete="current-password" /></label><button>再認可して復元</button></form>}</section>}
      {passwordFormOpen && <section className="editor"><h2>自分のパスワードを変更</h2><form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.changeOwnPassword({ currentPassword: String(f.get('currentPassword') ?? ''), newPassword: String(f.get('newPassword') ?? ''), confirmPassword: String(f.get('confirmPassword') ?? '') }); if (r.ok) { setSession(null); setPasswordFormOpen(false); setNotice('変更しました。新しいパスワードでログインしてください。') } else showError(r) })}><label>現在のパスワード<input name="currentPassword" required type="password" autoComplete="current-password" /></label><label>新しいパスワード（4〜128文字）<input name="newPassword" required type="password" autoComplete="new-password" /></label><label>確認入力<input name="confirmPassword" required type="password" autoComplete="new-password" /></label><p className="hint">DEMO版では新しく設定するパスワードを4〜128 Unicodeコードポイントで設定できます。</p><div className="actions"><button>変更する</button><button type="button" className="secondary" onClick={() => setPasswordFormOpen(false)}>キャンセル</button></div></form></section>}
      <footer className="page-footer"><button className="link" onClick={() => setPasswordFormOpen(!passwordFormOpen)}>自分のパスワードを変更</button></footer>
      {notice && <p className="notice" role="status">{notice}{issuedCode && <button className="secondary" onClick={() => { void navigator.clipboard?.writeText(issuedCode); setNotice('再設定コードをクリップボードへコピーしました。') }}>コードをコピー</button>}<button type="button" className="link" onClick={() => { setNotice(''); setIssuedCode('') }}>閉じる</button></p>}{error && <p role="alert" className="error">{error}</p>}
    </section>
  </main>
}

function MovementTable({ items, onHistory }: { items: readonly StockMovementSummary[]; onHistory?: (movement: StockMovementSummary) => void }): React.JSX.Element {
  return <div className="table-wrap"><table><thead><tr><th>日時</th><th>SKU</th><th>商品</th><th>種別</th><th>差分</th><th>変更前</th><th>変更後</th><th>理由</th><th>メモ</th><th>操作者</th>{onHistory && <th>表示</th>}</tr></thead><tbody>{items.map((movement) => <tr key={movement.id}><td>{new Date(movement.createdAt).toLocaleString()}</td><td>{movement.productSku}</td><td>{movement.productName}</td><td>{movement.type === 'RECEIPT' ? '入庫' : movement.type === 'ISSUE' ? '出庫' : movement.type === 'ADJUSTMENT' ? '棚卸' : '初期在庫'}</td><td>{movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta}</td><td>{movement.stockBefore}</td><td>{movement.stockAfter}</td><td>{reasonLabels[movement.reasonCode]}</td><td>{movement.note ?? ''}</td><td>{movement.actorDisplayName}（{movement.actorLoginName}）</td>{onHistory && <td><button className="small secondary" onClick={() => onHistory(movement)}>商品履歴</button></td>}</tr>)}</tbody></table></div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
