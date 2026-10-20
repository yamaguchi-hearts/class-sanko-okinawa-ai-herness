import '@vitejs/plugin-react/preamble'
import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CategorySummary, ProductDraft, ProductListQuery, ProductSummary, SessionView, UserSummary } from '../shared/contracts'
import './style.css'

const initialQuery: ProductListQuery = { search: '', categoryId: null, status: 'ACTIVE', stockFilter: 'ALL', sortKey: 'name', direction: 'asc', page: 1, pageSize: 50 }
const blankProduct: ProductDraft = { sku: '', name: '', categoryId: null, unit: '個', reorderLevel: 0, note: null }
type Tab = 'products' | 'categories' | 'users'

function App(): React.JSX.Element {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [recoveryRequired, setRecoveryRequired] = useState(false)
  const [session, setSession] = useState<SessionView | null>(null)
  const [error, setError] = useState('')
  const [resetMode, setResetMode] = useState(false)
  const [notice, setNotice] = useState('')
  const [issuedCode, setIssuedCode] = useState('')
  const [tab, setTab] = useState<Tab>('products')
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

  const refresh = useCallback(async () => {
    const setup = await window.storeApp.setup.isRequired()
    if (!setup.ok) { setError(setup.error.message); setRecoveryRequired(setup.error.code === 'RECOVERY_REQUIRED'); setSetupRequired(false); return }
    setError(''); setRecoveryRequired(false); setSetupRequired(setup.value)
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
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 1000); return () => window.clearInterval(timer) }, [refresh])
  useEffect(() => {
    if (session?.state !== 'AUTHENTICATED') return
    if (session.user.role === 'ADMIN') void refreshUsers()
    void refreshCategories()
    void refreshProducts(query)
  }, [session?.state, session?.user.id, session?.user.role, query, refreshUsers, refreshCategories, refreshProducts])

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
      : await window.storeApp.products.create(draft)
    if (!result.ok) { showError(result); return }
    setProductFormOpen(false); setNotice(editProductId ? '商品を更新しました。' : '商品を登録しました。')
    await refreshProducts()
  }
  const updateQuery = (patch: Partial<ProductListQuery>) => setQuery((old) => ({ ...old, ...patch, page: 1 }))

  if (setupRequired === null) return <main className="shell"><p role="status">起動しています…</p></main>
  if (recoveryRequired) return <main className="shell"><section className="card"><h1>管理者による復旧が必要です</h1><p className="error" role="alert">{error}</p><p>通常の初期セットアップから権限を再作成することはできません。データベースを保持し、管理者復旧手順を確認してください。</p></section></main>
  if (setupRequired) return <main className="shell"><section className="card"><h1>初期セットアップ</h1><p>店舗と最初の管理者を登録します。</p>
    <form onSubmit={(e) => void onSubmit(e, async (f) => {
      const result = await window.storeApp.setup.createInitialAdmin({ storeName: String(f.get('storeName') ?? ''), displayName: String(f.get('displayName') ?? ''), loginName: String(f.get('loginName') ?? ''), password: String(f.get('password') ?? ''), confirmPassword: String(f.get('confirmPassword') ?? '') })
      if (result.ok) setSession(result.value); else showError(result)
    })}>
      <label>店舗名<input name="storeName" required maxLength={100} /></label><label>管理者表示名<input name="displayName" required maxLength={100} /></label><label>ログインID<input name="loginName" required maxLength={64} autoComplete="username" /></label><label>パスワード（12〜128文字）<input name="password" required minLength={12} maxLength={128} type="password" autoComplete="new-password" /></label><label>パスワード（確認）<input name="confirmPassword" required minLength={12} maxLength={128} type="password" autoComplete="new-password" /></label>
      <button>初期設定を完了</button>
    </form>{error && <p className="error" role="alert">{error}</p>}</section></main>

  if (!session) return <main className="shell"><section className="card"><h1>沖縄店舗在庫管理</h1><p>{resetMode ? '再設定コードを入力してください。' : 'ログインしてください。'}</p>
    {!resetMode ? <form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.login({ loginName: String(f.get('loginName') ?? ''), password: String(f.get('password') ?? '') }); if (r.ok) setSession(r.value); else showError(r) })}><label>ログインID<input name="loginName" required autoComplete="username" /></label><label>パスワード<input name="password" required type="password" autoComplete="current-password" /></label><button>ログイン</button></form> : <form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.beginPasswordReset({ loginName: String(f.get('loginName') ?? ''), code: String(f.get('code') ?? '') }); if (r.ok) setSession(r.value); else showError(r) })}><label>ログインID<input name="loginName" required autoComplete="username" /></label><label>再設定コード<input name="code" required autoComplete="one-time-code" /></label><button>コードを確認</button></form>}
    <button className="link" onClick={() => { setResetMode(!resetMode); setError('') }}>{resetMode ? 'ログインに戻る' : '再設定コードを使う'}</button>{notice && <p className="notice" role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</section></main>

  if (session.state === 'LOCKED') return <main className="shell"><section className="card"><h1>画面をロックしました</h1><p>{session.user.displayName} さん。続行するにはパスワードを入力してください。</p><form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.unlock(String(f.get('password') ?? '')); if (r.ok) setSession(r.value); else showError(r) })}><label>パスワード<input name="password" autoFocus required type="password" autoComplete="current-password" /></label><button>ロックを解除</button></form><button className="link" onClick={logout}>ログアウト</button>{error && <p role="alert" className="error">{error}</p>}</section></main>

  if (session.state === 'PASSWORD_RESET_REQUIRED') return <main className="shell"><section className="card"><h1>新しいパスワード</h1><p>本人確認が完了しました。新しいパスワードを設定してください。</p><form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.completePasswordReset({ password: String(f.get('password') ?? ''), confirmPassword: String(f.get('confirmPassword') ?? '') }); if (r.ok) { setResetMode(false); setSession(null); setNotice('パスワードを設定しました。ログインしてください。') } else showError(r) })}><label>新しいパスワード<input name="password" required minLength={12} maxLength={128} type="password" autoComplete="new-password" /></label><label>確認入力<input name="confirmPassword" required minLength={12} maxLength={128} type="password" autoComplete="new-password" /></label><button>パスワードを設定</button></form><button className="link" onClick={() => { logout(); setResetMode(false) }}>キャンセル</button>{error && <p className="error" role="alert">{error}</p>}</section></main>

  return <main className="shell wide"><header className="topbar"><div><strong>{session.storeName}</strong><span>店舗在庫管理</span></div><div>{session.user.displayName}（{session.user.role}） <button className="secondary" onClick={logout}>ログアウト</button></div></header>
    <nav className="tabs" aria-label="管理画面">{(['products', 'categories', ...(session.user.role === 'ADMIN' ? ['users'] : [])] as Tab[]).map((item) => <button key={item} className={tab === item ? 'selected' : 'secondary'} onClick={() => { setTab(item); setError(''); setNotice('') }}>{item === 'products' ? '商品一覧' : item === 'categories' ? 'カテゴリ管理' : 'ユーザー管理'}</button>)}</nav>
    <section className="card">
      {tab === 'products' && <section><header className="section-heading"><div><h1>商品一覧</h1><p>登録商品数: {productTotal}</p></div>{session.user.role === 'ADMIN' && <button onClick={startProductCreate}>商品を登録</button>}</header>
        <div className="filters"><label>SKU・商品名検索<input value={query.search} onChange={(e) => updateQuery({ search: e.target.value })} maxLength={200} placeholder="検索語" /></label><label>カテゴリ<select value={query.categoryId ?? ''} onChange={(e) => updateQuery({ categoryId: e.target.value || null })}><option value="">すべて</option>{categories.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>状態<select value={query.status} onChange={(e) => updateQuery({ status: e.target.value as ProductListQuery['status'] })}><option value="ACTIVE">有効</option><option value="INACTIVE">無効</option><option value="ALL">すべて</option></select></label><label>並び順<select value={query.sortKey} onChange={(e) => updateQuery({ sortKey: e.target.value as ProductListQuery['sortKey'] })}><option value="name">商品名</option><option value="sku">SKU</option><option value="currentStock">現在庫</option><option value="reorderLevel">最低在庫</option></select></label><label>方向<select value={query.direction} onChange={(e) => updateQuery({ direction: e.target.value as ProductListQuery['direction'] })}><option value="asc">昇順</option><option value="desc">降順</option></select></label><label>在庫条件<select value={query.stockFilter} onChange={(e) => updateQuery({ stockFilter: e.target.value as ProductListQuery['stockFilter'] })}><option value="ALL">すべて</option><option value="LOW">低在庫</option><option value="ZERO">在庫0</option></select></label></div>
        {productFormOpen && session.user.role === 'ADMIN' && <form className="editor" onSubmit={(e) => void onSubmit(e, saveProduct)}><h2>{editProductId ? '商品を編集' : '商品を登録'}</h2><div className="form-grid"><label>SKU<input name="sku" required maxLength={64} pattern="[A-Za-z0-9_-]+" value={productDraft.sku} onChange={(e) => setProductDraft({ ...productDraft, sku: e.target.value })} /></label><label>商品名<input name="name" required maxLength={200} value={productDraft.name} onChange={(e) => setProductDraft({ ...productDraft, name: e.target.value })} /></label><label>カテゴリ<select name="categoryId" value={productDraft.categoryId ?? ''} onChange={(e) => setProductDraft({ ...productDraft, categoryId: e.target.value || null })}><option value="">未分類</option>{categories.filter((c) => c.isActive || (editProductId && c.id === productDraft.categoryId)).map((c) => <option key={c.id} value={c.id}>{c.name}{c.isActive ? '' : '（無効・既存）'}</option>)}</select></label><label>単位<input name="unit" required maxLength={16} value={productDraft.unit} onChange={(e) => setProductDraft({ ...productDraft, unit: e.target.value })} /></label><label>最低在庫数<input name="reorderLevel" type="number" required min={0} max={2147483647} value={productDraft.reorderLevel} onChange={(e) => setProductDraft({ ...productDraft, reorderLevel: Number(e.target.value) })} /></label><label>メモ<textarea name="note" maxLength={2000} value={productDraft.note ?? ''} onChange={(e) => setProductDraft({ ...productDraft, note: e.target.value || null })} /></label></div><p className="hint">新規商品の現在庫は0です。在庫数は商品編集では変更できません。</p><div className="actions"><button>{editProductId ? '変更を保存' : '登録'}</button><button type="button" className="secondary" onClick={() => setProductFormOpen(false)}>キャンセル</button></div></form>}
        {loadingProducts ? <p role="status">商品を読み込んでいます…</p> : products.length === 0 ? <p className="empty">条件に一致する商品はありません。</p> : <div className="table-wrap"><table><thead><tr><th>SKU</th><th>商品名</th><th>カテゴリ</th><th>在庫</th><th>在庫状態</th><th>最低在庫</th><th>単位</th><th>状態</th>{session.user.role === 'ADMIN' && <th>操作</th>}</tr></thead><tbody>{products.map((p) => <tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{p.categoryName ?? '未分類'}{p.categoryActive === false && <small>（無効カテゴリ）</small>}</td><td>{p.currentStock}</td><td>{p.currentStock === 0 ? `在庫0${p.reorderLevel > 0 ? '・低在庫' : ''}` : p.reorderLevel > 0 && p.currentStock <= p.reorderLevel ? '低在庫' : '通常'}</td><td>{p.reorderLevel}</td><td>{p.unit}</td><td>{p.isActive ? '有効' : '無効'}</td>{session.user.role === 'ADMIN' && <td><button className="small secondary" onClick={() => startProductEdit(p)}>編集</button>{p.isActive && <button className="small secondary" onClick={async () => { if (!window.confirm(`「${p.name}」を無効化しますか？商品情報と履歴は保持されます。`)) return; const r = await window.storeApp.products.deactivate(p.id); if (r.ok) await refreshProducts(); else showError(r) }}>無効化</button>}</td>}</tr>)}</tbody></table></div>}
        <div className="pager"><span>{productTotal === 0 ? 0 : (query.page - 1) * query.pageSize + 1}–{Math.min(query.page * query.pageSize, productTotal)} / {productTotal}</span><button className="secondary" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>前へ</button><span>ページ {query.page}</span><button className="secondary" disabled={query.page * query.pageSize >= productTotal} onClick={() => setQuery({ ...query, page: query.page + 1 })}>次へ</button></div>
      </section>}

      {tab === 'categories' && <section><header className="section-heading"><div><h1>カテゴリ管理</h1><p>カテゴリの無効化後も既存商品との関連は保持されます。</p></div></header>{session.user.role === 'ADMIN' && <form className="inline-form" onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.categories.create(String(f.get('name') ?? '')); if (r.ok) { setNotice('カテゴリを作成しました。'); await refreshCategories() } else showError(r) })}><label>カテゴリ名<input name="name" required maxLength={100} /></label><button>カテゴリを追加</button></form>}<ul className="managed-list">{categories.map((c) => <li key={c.id}><form className="inline-form" onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.categories.update({ categoryId: c.id, name: String(f.get('name') ?? '') }); if (r.ok) { setNotice('カテゴリ名を更新しました。'); await refreshCategories() } else showError(r) })}><label>カテゴリ名<input name="name" defaultValue={c.name} required maxLength={100} /></label><span className="state">{c.isActive ? '有効' : '無効'}</span>{session.user.role === 'ADMIN' && <><button className="secondary">名称を保存</button>{c.isActive && <button type="button" className="secondary" onClick={async () => { if (!window.confirm(`「${c.name}」を無効化しますか？既存商品のカテゴリ情報は保持されます。`)) return; const r = await window.storeApp.categories.deactivate(c.id); if (r.ok) await refreshCategories(); else showError(r) }}>無効化</button>}</>}</form></li>)}</ul></section>}

      {tab === 'users' && session.user.role === 'ADMIN' && <section><header className="section-heading"><div><h1>ユーザー管理</h1><p>新しい利用者は一度限りのコードで本人がパスワードを設定します。</p></div></header><form className="inline-form" onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.users.create({ loginName: String(f.get('loginName') ?? ''), displayName: String(f.get('displayName') ?? ''), role: String(f.get('role') ?? 'STAFF') as 'ADMIN' | 'STAFF' }); if (r.ok) { setIssuedCode(r.value.code); setNotice(`本人へ15分以内に伝えてください。再設定コード: ${r.value.code}`); await refreshUsers() } else showError(r) })}><label>ログインID<input name="loginName" required maxLength={64} /></label><label>表示名<input name="displayName" required maxLength={100} /></label><label>ロール<select name="role"><option>STAFF</option><option>ADMIN</option></select></label><button>ユーザー作成・コード発行</button></form><ul className="managed-list">{users.map((u) => <li key={u.id}><div className="user-heading"><strong>{u.loginName}</strong><span>{u.isActive ? '有効' : '無効'}{u.mustChangePassword ? '・初期設定待ち' : ''}</span></div><form className="inline-form" onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.users.update({ userId: u.id, displayName: String(f.get('displayName') ?? ''), role: String(f.get('role') ?? u.role) as 'ADMIN' | 'STAFF' }); if (r.ok) { setNotice('ユーザー情報を更新しました。'); await refreshUsers() } else showError(r) })}><label>表示名<input name="displayName" defaultValue={u.displayName} required maxLength={100} /></label><label>ロール<select name="role" defaultValue={u.role}><option>STAFF</option><option>ADMIN</option></select></label><button className="secondary">変更を保存</button>{u.isActive && <><button type="button" className="secondary" onClick={async () => { const r = await window.storeApp.users.issuePasswordReset(u.id); if (r.ok) { setIssuedCode(r.value.code); setNotice(`本人へ15分以内に伝えてください。再設定コード: ${r.value.code}`) } else showError(r) }}>コード再発行</button>{u.id !== session.user.id && <button type="button" className="secondary" onClick={async () => { if (!window.confirm(`「${u.displayName}」を無効化しますか？この利用者のセッションは失効します。`)) return; const r = await window.storeApp.users.deactivate(u.id); if (r.ok) await refreshUsers(); else showError(r) }}>無効化</button>}</>}</form></li>)}</ul></section>}

      {passwordFormOpen && <section className="editor"><h2>自分のパスワードを変更</h2><form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.changeOwnPassword({ currentPassword: String(f.get('currentPassword') ?? ''), newPassword: String(f.get('newPassword') ?? ''), confirmPassword: String(f.get('confirmPassword') ?? '') }); if (r.ok) { setSession(null); setPasswordFormOpen(false); setNotice('変更しました。新しいパスワードでログインしてください。') } else showError(r) })}><label>現在のパスワード<input name="currentPassword" required type="password" autoComplete="current-password" /></label><label>新しいパスワード<input name="newPassword" required minLength={12} maxLength={128} type="password" autoComplete="new-password" /></label><label>確認入力<input name="confirmPassword" required minLength={12} maxLength={128} type="password" autoComplete="new-password" /></label><div className="actions"><button>変更する</button><button type="button" className="secondary" onClick={() => setPasswordFormOpen(false)}>キャンセル</button></div></form></section>}
      <footer className="page-footer"><button className="link" onClick={() => setPasswordFormOpen(!passwordFormOpen)}>自分のパスワードを変更</button></footer>
      {notice && <p className="notice" role="status">{notice}{issuedCode && <button className="secondary" onClick={() => { void navigator.clipboard?.writeText(issuedCode); setNotice('再設定コードをクリップボードへコピーしました。') }}>コードをコピー</button>}<button type="button" className="link" onClick={() => { setNotice(''); setIssuedCode('') }}>閉じる</button></p>}{error && <p role="alert" className="error">{error}</p>}
    </section>
  </main>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
