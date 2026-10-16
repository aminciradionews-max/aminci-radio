import { createClient } from '@supabase/supabase-js'
import type { Handler } from '@netlify/functions'
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
export const handler: Handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Registration service is not configured.' }) }
  try {
    const body = JSON.parse(event.body || '{}') as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim() : '', phone = typeof body.phone === 'string' ? body.phone.replace(/\s/g, '') : '', email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const state = typeof body.state === 'string' ? body.state.trim() : '', lga = typeof body.lga === 'string' ? body.lga.trim() : '', interest = typeof body.interests === 'string' ? body.interests : '', gender = typeof body.gender === 'string' ? body.gender : ''
    if (name.length < 2 || name.length > 120 || !/^\+?[0-9]{10,15}$/.test(phone) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || !state || !lga || !['Male','Female'].includes(gender) || !['Social Media','Cybersecurity','Artificial Intelligence','All Topics'].includes(interest)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please check the required fields and try again.' }) }
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    const { data: existing, error: duplicateError } = await db.from('registrations').select('id').or(`phone.eq.${phone}${email ? `,email.eq.${email}` : ''}`).limit(1)
    if (duplicateError) throw duplicateError
    if (existing?.length) return { statusCode: 409, headers, body: JSON.stringify({ error: 'A registration already exists with this phone number or email.' }) }
    const { data: settings } = await db.from('event_settings').select('registration_open').limit(1).maybeSingle()
    if (settings && !settings.registration_open) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Registration is currently closed.' }) }
    const { data, error } = await db.from('registrations').insert({ full_name: name, phone, email: email || null, gender, state, lga, occupation: typeof body.occupation === 'string' ? body.occupation.slice(0,160) : null, interests: interest }).select('id,reference,full_name,phone,email,gender,state,lga,occupation,interests,payment_status,created_at').single()
    if (error) throw error
    return { statusCode: 201, headers, body: JSON.stringify({ registration: { id: data.reference, name: data.full_name, phone: data.phone, email: data.email || '', gender: data.gender, state: data.state, lga: data.lga, occupation: data.occupation || '', interests: data.interests, status: data.payment_status, date: data.created_at } }) }
  } catch (error) { console.error('registration failed', error); return { statusCode: 500, headers, body: JSON.stringify({ error: 'We could not save your registration. Please try again.' }) } }
}
