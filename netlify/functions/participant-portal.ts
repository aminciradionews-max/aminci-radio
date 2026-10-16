import { createHash, createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Handler } from '@netlify/functions'

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed.' }) }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Participant service is not configured.' }) }
  try {
    const body = JSON.parse(event.body || '{}') as { accessToken?: unknown }
    const token = typeof body.accessToken === 'string' ? body.accessToken : ''
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return { statusCode: 401, headers, body: JSON.stringify({ error: 'This participant link is invalid. Ask event staff for a new link.' }) }
    const hash = createHash('sha256').update(token).digest('hex')
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    const { data, error } = await db.from('registrations').select('id,reference,full_name,phone,email,gender,age,residential_address,device_type,state,lga,occupation,interests,payment_status,created_at').eq('participant_access_hash', hash).maybeSingle()
    if (error) throw error
    if (!data) return { statusCode: 404, headers, body: JSON.stringify({ error: 'This participant link is invalid or has been replaced. Ask event staff for help.' }) }
    let ticketToken: string | undefined
    if (data.payment_status === 'Paid — Verified') {
      const { data: ticket, error: ticketReadError } = await db.from('tickets').select('id,revoked').eq('registration_id', data.id).maybeSingle()
      if (ticketReadError) throw ticketReadError
      if (!ticket || !ticket.revoked) {
        // Derive a stable ticket token distinct from the participant portal token.
        // Scanning a QR therefore cannot grant access to the participant portal.
        ticketToken = createHmac('sha256', key).update(`aminci-ticket:${data.id}`).digest('base64url')
        const ticketHash = createHash('sha256').update(ticketToken).digest('hex')
        const { error: ticketWriteError } = ticket
          ? await db.from('tickets').update({ token_hash: ticketHash }).eq('id', ticket.id)
          : await db.from('tickets').insert({ registration_id: data.id, token_hash: ticketHash })
        if (ticketWriteError) throw ticketWriteError
      }
    }
    const { data: settings, error: settingsError } = await db.from('event_settings').select('event_date,deadline,venue,event_time,bank_name,account_name,account_number,payment_reference,payment_instructions,support_contact,registration_open').eq('id', 1).maybeSingle()
    if (settingsError) throw settingsError
    return { statusCode: 200, headers, body: JSON.stringify({ ticketToken, registration: { id: data.reference, name: data.full_name, phone: data.phone, email: data.email || '', gender: data.gender || '', age: data.age || 0, residentialAddress: data.residential_address || '', deviceType: data.device_type || '', state: data.state, lga: data.lga, occupation: data.occupation || '', interests: data.interests, status: data.payment_status, date: data.created_at }, settings: settings ? { eventDate: settings.event_date || '', deadline: settings.deadline || '', venue: settings.venue || '', time: settings.event_time || '', bank: settings.bank_name || '', account: settings.account_name || '', number: settings.account_number || '', reference: settings.payment_reference || '', instructions: settings.payment_instructions || '', contact: settings.support_contact || '', open: settings.registration_open } : undefined }) }
  } catch (error) {
    console.error('participant portal lookup failed', error)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not load registration details. Please try again.' }) }
  }
}
