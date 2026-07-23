import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import LedgerApp from './LedgerApp'
import './styles.css'
import './ledger.css'

const isLookupPage = window.location.hash.toLowerCase().startsWith('#/lookup')

if (!isLookupPage) {
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}ledger-sw.js`)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isLookupPage ? <App /> : <LedgerApp />}</React.StrictMode>,
)
