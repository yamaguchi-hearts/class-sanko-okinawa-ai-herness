import '@vitejs/plugin-react/preamble'
import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

function App(): React.JSX.Element {
  return <main><h1>沖縄店舗在庫管理</h1><p>Phase 0 技術検証用の起動骨格です。</p><p>業務機能は次のフェーズで実装します。</p></main>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
