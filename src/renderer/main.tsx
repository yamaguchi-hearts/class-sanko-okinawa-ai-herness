import '@vitejs/plugin-react/preamble'
import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { SessionView, UserSummary } from '../shared/contracts'
import './style.css'

function App(): React.JSX.Element {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [recoveryRequired, setRecoveryRequired] = useState(false)
  const [session, setSession] = useState<SessionView | null>(null)
  const [error, setError] = useState('')
  const [resetMode, setResetMode] = useState(false)
  const [users, setUsers] = useState<UserSummary[]>([])
  const [notice, setNotice] = useState('')
  const [resetCode, setResetCode] = useState('')
  const refresh = useCallback(async () => {
    const setup = await window.storeApp.setup.isRequired()
    if (!setup.ok) { setError(setup.error.message); setRecoveryRequired(setup.error.code === 'RECOVERY_REQUIRED'); setSetupRequired(false); return }
    setError(''); setRecoveryRequired(false)
    setSetupRequired(setup.value)
    if (!setup.value) {
      const result = await window.storeApp.auth.getSession()
      if (result.ok) setSession(result.value)
    }
  }, [])
  const refreshUsers = useCallback(async () => {
    const result = await window.storeApp.users.list()
    if (result.ok) setUsers(result.value)
  }, [])
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 1000); return () => window.clearInterval(timer) }, [refresh])
  useEffect(() => { if (session?.state === 'AUTHENTICATED' && session.user.role === 'ADMIN') void refreshUsers() }, [session, refreshUsers])
  const onSubmit = async (event: React.FormEvent<HTMLFormElement>, action: (form: FormData) => Promise<void>) => {
    event.preventDefault(); setError(''); setNotice('')
    const form = event.currentTarget
    await action(new FormData(form))
    form.querySelectorAll<HTMLInputElement>('input[type="password"], input[name="code"]').forEach((input) => { input.value = '' })
  }
  const showError = (result: { ok: boolean; error?: { message: string } }) => { if (!result.ok) setError(result.error?.message ?? '処理を完了できませんでした。') }

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
    {!resetMode ? <form onSubmit={(e) => void onSubmit(e, async (f) => {
      const result = await window.storeApp.auth.login({ loginName: String(f.get('loginName') ?? ''), password: String(f.get('password') ?? '') })
      if (result.ok) setSession(result.value); else showError(result)
    })}><label>ログインID<input name="loginName" required autoComplete="username" /></label><label>パスワード<input name="password" required type="password" autoComplete="current-password" /></label><button>ログイン</button></form> : <form onSubmit={(e) => void onSubmit(e, async (f) => {
      const result = await window.storeApp.auth.beginPasswordReset({ loginName: String(f.get('loginName') ?? ''), code: String(f.get('code') ?? '') })
      if (result.ok) setSession(result.value); else showError(result)
    })}><label>ログインID<input name="loginName" required autoComplete="username" /></label><label>再設定コード<input name="code" required autoComplete="one-time-code" /></label><button>コードを確認</button></form>}
    <button className="link" onClick={() => { setResetMode(!resetMode); setError('') }}>{resetMode ? 'ログインに戻る' : '再設定コードを使う'}</button>{notice && <p className="notice" role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</section></main>

  if (session.state === 'LOCKED') return <main className="shell"><section className="card"><h1>画面をロックしました</h1><p>{session.user.displayName} さん。続行するにはパスワードを入力してください。</p><form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.unlock(String(f.get('password') ?? '')); if (r.ok) setSession(r.value); else showError(r) })}><label>パスワード<input name="password" autoFocus required type="password" autoComplete="current-password" /></label><button>ロックを解除</button></form><button className="link" onClick={() => { void window.storeApp.auth.logout(); setSession(null) }}>ログアウト</button>{error && <p role="alert" className="error">{error}</p>}</section></main>

  if (session.state === 'PASSWORD_RESET_REQUIRED') return <main className="shell"><section className="card"><h1>新しいパスワード</h1><p>本人確認が完了しました。新しいパスワードを設定してください。</p><form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.completePasswordReset({ password: String(f.get('password') ?? ''), confirmPassword: String(f.get('confirmPassword') ?? '') }); if (r.ok) { setResetMode(false); setSession(null); setNotice('パスワードを設定しました。ログインしてください。') } else showError(r) })}><label>新しいパスワード<input name="password" required minLength={12} maxLength={128} type="password" autoComplete="new-password" /></label><label>確認入力<input name="confirmPassword" required minLength={12} maxLength={128} type="password" autoComplete="new-password" /></label><button>パスワードを設定</button></form><button className="link" onClick={() => { void window.storeApp.auth.logout(); setSession(null); setResetMode(false) }}>キャンセル</button>{error && <p className="error" role="alert">{error}</p>}</section></main>

  return <main className="shell wide"><header className="topbar"><div><strong>{session.storeName}</strong><span>店舗在庫管理</span></div><div>{session.user.displayName}（{session.user.role}） <button className="secondary" onClick={() => { void window.storeApp.auth.logout(); setSession(null) }}>ログアウト</button></div></header><section className="card"><h1>認証・ユーザー基盤</h1><p>Phase 1: 初期設定、本人認証、パスワード再設定の基盤</p><button className="secondary" onClick={() => { setError(''); (document.getElementById('password-dialog') as HTMLDialogElement).showModal() }}>自分のパスワードを変更</button>
    <dialog id="password-dialog"><h2>パスワード変更</h2><form onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.auth.changeOwnPassword({ currentPassword: String(f.get('currentPassword') ?? ''), newPassword: String(f.get('newPassword') ?? ''), confirmPassword: String(f.get('confirmPassword') ?? '') }); if (r.ok) { (document.getElementById('password-dialog') as HTMLDialogElement).close(); setSession(null); setNotice('変更しました。新しいパスワードでログインしてください。') } else showError(r) })}><label>現在のパスワード<input name="currentPassword" required type="password" autoComplete="current-password" /></label><label>新しいパスワード<input name="newPassword" required minLength={12} maxLength={128} type="password" autoComplete="new-password" /></label><label>確認入力<input name="confirmPassword" required minLength={12} maxLength={128} type="password" autoComplete="new-password" /></label><button>変更する</button><button type="button" className="secondary" onClick={() => (document.getElementById('password-dialog') as HTMLDialogElement).close()}>閉じる</button></form></dialog>
    {session.user.role === 'ADMIN' && <section className="users"><h2>ユーザー（Phase 1 最小画面）</h2><form className="inline-form" onSubmit={(e) => void onSubmit(e, async (f) => { const r = await window.storeApp.users.create({ loginName: String(f.get('loginName') ?? ''), displayName: String(f.get('displayName') ?? ''), role: String(f.get('role') ?? 'STAFF') as 'ADMIN' | 'STAFF' }); if (r.ok) { setResetCode(r.value.code); setNotice(`本人へ15分以内に伝えてください。コード: ${r.value.code}`); await refreshUsers() } else showError(r) })}><label>ログインID<input name="loginName" required maxLength={64} /></label><label>表示名<input name="displayName" required maxLength={100} /></label><label>ロール<select name="role"><option>STAFF</option><option>ADMIN</option></select></label><button>ユーザー作成・コード発行</button></form><ul>{users.map((u) => <li key={u.id}><strong>{u.displayName}</strong> — {u.loginName} / {u.role} / {u.isActive ? '有効' : '無効'} {u.mustChangePassword && '（初期設定待ち）'}<div className="actions"><button className="secondary" onClick={async () => { const r = await window.storeApp.users.issuePasswordReset(u.id); if (r.ok) { setResetCode(r.value.code); setNotice(`本人へ15分以内に伝えてください。コード: ${r.value.code}`) } else showError(r) }}>コード再発行</button>{u.isActive && u.id !== session.user.id && <button className="secondary" onClick={async () => { const r = await window.storeApp.users.deactivate(u.id); if (r.ok) await refreshUsers(); else showError(r) }}>無効化</button>}</div></li>)}</ul></section>}
    {notice && <p className="notice" role="status">{notice}{resetCode && <button className="secondary" onClick={() => { void navigator.clipboard?.writeText(resetCode); setNotice('コードをクリップボードへコピーしました。') }}>コードをコピー</button>}</p>}{error && <p role="alert" className="error">{error}</p>}</section></main>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
