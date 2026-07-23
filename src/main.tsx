import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import LedgerApp from './LedgerApp'
import './styles.css'
import './ledger.css'

const isLedgerPage = window.location.hash.toLowerCase().startsWith('#/ledger')

if (isLedgerPage) {
  const manifest = document.createElement('link')
  manifest.rel = 'manifest'
  manifest.href = `${import.meta.env.BASE_URL}ledger.webmanifest`
  document.head.appendChild(manifest)
  if ('serviceWorker' in navigator) window.addEventListener('load', () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}ledger-sw.js`))
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isLedgerPage ? <LedgerApp /> : <App />}</React.StrictMode>,
)
