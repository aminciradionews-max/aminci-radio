import { createClient } from '@supabase/supabase-js'
import type { Handler } from '@netlify/functions'
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
export const handler: Handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY, token = event.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!url || !key || !token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required.' }) }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const authResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } })
  const authUser = authResponse.ok ? await authResponse.json() as { id?: string } : null
  if (!authUser?.id) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session.' }) }
  const { data: profile } = await db.from('profiles').select('role,active').eq('id', authUser.id).single()
  if (!profile?.active || !['admin','finance','checkin'].includes(profile.role)) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Insufficient permission.' }) }
  try {
    const body = JSON.parse(event.body || '{}') as { action?: string; registrationId?: string; reason?: string; settings?: Record<string,unknown> }
    const id = body.registrationId
    if (body.action === 'verify_payment' && ['admin','finance'].includes(profile.role) && id) {
      const { data, error } = await db.rpc('admin_verify_payment', { target_registration: id, staff_user: authUser.id }); if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify({ result: data }) }
    }
    if (body.action === 'reject_payment' && ['admin','finance'].includes(profile.role) && id && body.reason?.trim()) {
      const { error } = await db.rpc('admin_reject_payment', { target_registration: id, staff_user: authUser.id, rejection_reason: body.reason.trim().slice(0,500) }); if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
    }
    if (body.action === 'check_in' && ['admin','checkin'].includes(profile.role) && id) {
      const { data, error } = await db.rpc('staff_check_in', { target_registration: id, staff_user: authUser.id }); if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify({ result: data }) }
    }
    if (body.action === 'revoke_ticket' && profile.role === 'admin' && id && body.reason?.trim()) {
      const { error } = await db.rpc('admin_revoke_ticket', { target_registration: id, staff_user: authUser.id, revocation_reason: body.reason.trim().slice(0,500) }); if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
    }
    if (body.action === 'save_settings' && profile.role === 'admin' && body.settings) {
      const { error } = await db.from('event_settings').upsert({ id: 1, ...body.settings, updated_by: authUser.id }, { onConflict: 'id' }); if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
    }
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Action not permitted.' }) }
  } catch (error) { console.error('admin action failed', error); return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action could not be completed.' }) } }
}
