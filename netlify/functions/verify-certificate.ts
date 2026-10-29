import { createClient } from '@supabase/supabase-js'
import type { Handler } from '@netlify/functions'
import { createHash } from 'node:crypto'

export const handler: Handler = async event => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  const token = event.queryStringParameters?.token
  if (!token || token.length > 128) return { statusCode: 400, headers, body: JSON.stringify({ result: 'INVALID CERTIFICATE' }) }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Verification service unavailable.' }) }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const { data, error } = await db.from('certificates')
    .select('certificate_number,issued_at,revoked,registrations!inner(reference,full_name,payment_status,check_ins(id))')
    .eq('token_hash', tokenHash).maybeSingle()
  if (error || !data) return { statusCode: 404, headers, body: JSON.stringify({ result: 'INVALID CERTIFICATE' }) }
  const registration = Array.isArray(data.registrations) ? data.registrations[0] : data.registrations as unknown as { reference: string; full_name: string; payment_status: string; check_ins: {id:string}[] }
  if (data.revoked) return { statusCode: 200, headers, body: JSON.stringify({ result: 'CERTIFICATE REVOKED', certificateNumber: data.certificate_number }) }
  if (registration.payment_status !== 'Paid — Verified' || !registration.check_ins?.length) {
    return { statusCode: 200, headers, body: JSON.stringify({ result: 'CERTIFICATE NOT VALID', certificateNumber: data.certificate_number }) }
  }
  return { statusCode: 200, headers, body: JSON.stringify({ result: 'VALID CERTIFICATE', certificateNumber: data.certificate_number, participantName: registration.full_name, registrationId: registration.reference, issuedAt: data.issued_at, event: 'Social Media, Cybersecurity & Artificial Intelligence Training', eventDate: '31 October 2026' }) }
}
