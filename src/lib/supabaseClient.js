import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null

export function requireSupabase() {
  if (!supabase) {
    throw new Error('ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY')
  }

  return supabase
}

export function getSupabaseDebugInfo() {
  return {
    configured: isSupabaseConfigured,
    url: supabaseUrl || '',
    maskedUrl: maskSupabaseUrl(supabaseUrl),
    projectRef: getProjectRef(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey),
  }
}

function getProjectRef(url) {
  if (!url) return ''

  try {
    return new URL(url).hostname.split('.')[0] || ''
  } catch {
    return ''
  }
}

function maskSupabaseUrl(url) {
  if (!url) return 'not configured'

  try {
    const parsed = new URL(url)
    const projectRef = parsed.hostname.split('.')[0] || ''
    const maskedRef = projectRef.length > 8 ? `${projectRef.slice(0, 4)}...${projectRef.slice(-4)}` : projectRef
    return `${parsed.protocol}//${maskedRef}.${parsed.hostname.split('.').slice(1).join('.')}`
  } catch {
    return 'invalid url'
  }
}
