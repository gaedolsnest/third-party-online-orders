import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && key && !url.includes('your-project'))
export const supabase = isSupabaseConfigured ? createClient(url!, key!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null

export const storeEmail = (storeCode: string) => {
  const normalized = storeCode.trim().normalize('NFKC').toLowerCase()
  if (/^\d{4}$/.test(normalized)) {
    const domain = import.meta.env.VITE_STORE_EMAIL_DOMAIN || 'stores.thirdparty-online.local'
    return `store-${normalized}@${domain}`
  }
  const bytes = new TextEncoder().encode(normalized)
  let hash = 14695981039346656037n
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 1099511628211n)
  }
  const safeCode = `store-${hash.toString(16).padStart(16, '0')}`
  const domain = import.meta.env.VITE_STORE_EMAIL_DOMAIN || 'stores.thirdparty-online.local'
  return `${safeCode}@${domain}`
}
