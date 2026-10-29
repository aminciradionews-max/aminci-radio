import { createClient } from '@supabase/supabase-js'
import type { Handler } from '@netlify/functions'
import { createHash, createHmac, randomBytes } from 'node:crypto'
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
    if (body.action === 'delete_registration' && profile.role === 'admin' && id && body.reason?.trim()) {
      const { data, error } = await db.rpc('admin_delete_registration', { target_registration: id, staff_user: authUser.id, deletion_reason: body.reason.trim().slice(0,500) })
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify({ deleted: data }) }
    }
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
    if (body.action === 'get_payment_receipt' && ['admin','finance'].includes(profile.role) && id) {
      const { data: payment, error: paymentError } = await db.from('payments').select('receipt_path')
        .eq('registration_id', id).not('receipt_path', 'is', null).order('submitted_at', { ascending: false }).limit(1).maybeSingle()
      if (paymentError) throw paymentError
      if (!payment?.receipt_path) return { statusCode: 404, headers, body: JSON.stringify({ error: 'No uploaded receipt is available for this registration.' }) }
      const { data: signed, error: signedError } = await db.storage.from('payment-receipts').createSignedUrl(payment.receipt_path, 300)
      if (signedError) throw signedError
      return { statusCode: 200, headers, body: JSON.stringify({ url: signed.signedUrl }) }
    }
    if (body.action === 'issue_participant_access' && profile.role === 'admin' && id) {
      const participantToken = randomBytes(32).toString('base64url')
      const participantHash = createHash('sha256').update(participantToken).digest('hex')
      const { data: registration, error: registrationError } = await db.from('registrations').select('id,payment_status').eq('id', id).maybeSingle()
      if (registrationError) throw registrationError
      if (!registration) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found.' }) }
      const { error: updateError } = await db.from('registrations').update({ participant_access_hash: participantHash }).eq('id', id)
      if (updateError) throw updateError
      const { error: auditError } = await db.from('audit_logs').insert({ actor_id: authUser.id, action: 'participant_access_issued', registration_id: id })
      if (auditError) throw auditError
      return { statusCode: 200, headers, body: JSON.stringify({ accessToken: participantToken }) }
    }
    if (body.action === 'reissue_paid_ticket' && profile.role === 'admin' && id) {
      const { data: registration, error: registrationError } = await db.from('registrations')
        .select('id,payment_status,reference').eq('id', id).maybeSingle()
      if (registrationError) throw registrationError
      if (!registration) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Registration not found.' }) }
      if (registration.payment_status !== 'Paid — Verified') {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'A ticket can only be reissued after payment is verified.' }) }
      }

      // Replace both opaque tokens so the newly generated PDF and participant
      // link are fresh. Previously issued QR tokens stop working immediately.
      const participantToken = randomBytes(32).toString('base64url')
      const ticketNonce = randomBytes(32).toString('base64url')
      const ticketToken = createHmac('sha256', key).update(`aminci-ticket:${id}:${ticketNonce}`).digest('base64url')
      const participantHash = createHash('sha256').update(participantToken).digest('hex')
      const ticketHash = createHash('sha256').update(ticketToken).digest('hex')
      const { data: currentTicket, error: ticketReadError } = await db.from('tickets')
        .select('id,revoked').eq('registration_id', id).maybeSingle()
      if (ticketReadError) throw ticketReadError
      if (currentTicket?.revoked) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'This ticket is revoked. Resolve the cancellation before issuing another ticket.' }) }
      }
      const ticketWrite = currentTicket
        ? await db.from('tickets').update({ token_hash: ticketHash, token_nonce: ticketNonce, issued_at: new Date().toISOString() }).eq('id', currentTicket.id)
        : await db.from('tickets').insert({ registration_id: id, token_hash: ticketHash, token_nonce: ticketNonce })
      if (ticketWrite.error) throw ticketWrite.error
      const { error: accessWriteError } = await db.from('registrations')
        .update({ participant_access_hash: participantHash }).eq('id', id)
      if (accessWriteError) throw accessWriteError
      const { error: auditError } = await db.from('audit_logs').insert({
        actor_id: authUser.id,
        action: 'paid_ticket_reissued',
        registration_id: id,
        details: { reference: registration.reference, previous_ticket_replaced: Boolean(currentTicket) }
      })
      if (auditError) throw auditError
      const { data: fullRegistration, error: detailsError } = await db.from('registrations')
        .select('reference,full_name,phone,email,gender,age,residential_address,device_type,state,lga,occupation,interests,payment_status,created_at')
        .eq('id', id).single()
      if (detailsError) throw detailsError
      return { statusCode: 200, headers, body: JSON.stringify({
        accessToken: participantToken,
        ticketToken,
        registration: { id: fullRegistration.reference, name: fullRegistration.full_name, phone: fullRegistration.phone,
          email: fullRegistration.email || '', gender: fullRegistration.gender || '', age: fullRegistration.age || 0,
          residentialAddress: fullRegistration.residential_address || '', deviceType: fullRegistration.device_type || '',
          state: fullRegistration.state, lga: fullRegistration.lga, occupation: fullRegistration.occupation || '',
          interests: fullRegistration.interests, status: fullRegistration.payment_status, date: fullRegistration.created_at }
      }) }
    }
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Action not permitted.' }) }
  } catch (error) { console.error('admin action failed', error); return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action could not be completed.' }) } }
}
