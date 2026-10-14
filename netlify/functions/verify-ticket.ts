import { createClient } from '@supabase/supabase-js'
import type { Handler } from '@netlify/functions'
export const handler: Handler = async event => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  const token = event.queryStringParameters?.token
  if (!token || token.length > 128) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid ticket.' }) }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Verification service unavailable.' }) }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const { data, error } = await db.from('tickets').select('id,registration_id,revoked,registrations!inner(reference,full_name,payment_status),check_ins(checked_in_at)').eq('token_hash', await hash(token)).maybeSingle()
  if (error || !data) return { statusCode: 404, headers, body: JSON.stringify({ result: 'INVALID TICKET' }) }
  const registration = Array.isArray(data.registrations) ? data.registrations[0] : data.registrations as unknown as { reference:string; full_name:string; payment_status:string }
  const result = data.revoked ? 'TICKET CANCELLED' : registration.payment_status !== 'Paid — Verified' ? 'PAYMENT NOT VERIFIED' : data.check_ins?.length ? 'ALREADY CHECKED IN' : 'VALID TICKET — PAYMENT VERIFIED'
  return { statusCode: 200, headers, body: JSON.stringify({ result, name: registration.full_name, registrationId: registration.reference, paymentStatus: registration.payment_status, checkedInAt: data.check_ins?.[0]?.checked_in_at || null }) }
}
async function hash(value:string) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('') }
