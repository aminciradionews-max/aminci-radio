import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Handler } from '@netlify/functions'

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const maxFileBytes = 2 * 1024 * 1024

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed.' }) }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Payment evidence service is not configured.' }) }
  let uploadedPath: string | undefined
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  try {
    const body = JSON.parse(event.body || '{}') as { accessToken?: unknown; transactionReference?: unknown; fileName?: unknown; contentType?: unknown; fileBase64?: unknown }
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken : ''
    const transactionReference = typeof body.transactionReference === 'string' ? body.transactionReference.trim() : ''
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(accessToken)) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Your participant link is invalid. Ask event staff for a replacement.' }) }
    if (transactionReference.length > 100) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Transaction reference must be 100 characters or fewer.' }) }
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
    const hasFile = fileBase64.length > 0
    if (!transactionReference && !hasFile) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Enter a transaction reference or attach your transfer receipt.' }) }

    const tokenHash = createHash('sha256').update(accessToken).digest('hex')
    const { data: registration, error: registrationError } = await db.from('registrations')
      .select('id,payment_status').eq('participant_access_hash', tokenHash).maybeSingle()
    if (registrationError) throw registrationError
    if (!registration) return { statusCode: 404, headers, body: JSON.stringify({ error: 'This participant link is invalid or has been replaced.' }) }
    if (registration.payment_status === 'Cancelled' || registration.payment_status === 'Paid — Verified') {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Payment evidence cannot be changed for this registration. Contact the event team if you need help.' }) }
    }
    const { data: current, error: currentError } = await db.from('payments').select('id,status,receipt_path')
      .eq('registration_id', registration.id).order('submitted_at', { ascending: false }).limit(1).maybeSingle()
    if (currentError) throw currentError
    if (current?.status === 'submitted') return { statusCode: 409, headers, body: JSON.stringify({ error: 'Your payment evidence is already under review. Contact the event team if you need to update it.' }) }

    let receiptPath: string | null = null
    if (hasFile) {
      if (fileBase64.length > Math.ceil(maxFileBytes * 4 / 3) + 8) return { statusCode: 413, headers, body: JSON.stringify({ error: 'Receipt file is too large. Maximum size is 2 MB.' }) }
      const bytes = Buffer.from(fileBase64, 'base64')
      if (bytes.length < 8 || bytes.length > maxFileBytes) return { statusCode: 413, headers, body: JSON.stringify({ error: 'Receipt file must be no larger than 2 MB.' }) }
      const mime = body.contentType
      const isPng = mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      const isJpeg = mime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      const isPdf = mime === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-'
      if (!isPng && !isJpeg && !isPdf) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Upload a valid JPG, PNG, or PDF receipt.' }) }
      const extension = isPng ? 'png' : isJpeg ? 'jpg' : 'pdf'
      receiptPath = `${registration.id}/${randomUUID()}.${extension}`
      const { error: uploadError } = await db.storage.from('payment-receipts').upload(receiptPath, bytes, { contentType: mime as string, upsert: false })
      if (uploadError) throw uploadError
      uploadedPath = receiptPath
    }

    const payment = { registration_id: registration.id, transaction_reference: transactionReference || null, receipt_path: receiptPath, status: 'submitted', rejection_reason: null, submitted_at: new Date().toISOString(), reviewed_at: null, reviewed_by: null }
    // Preserve rejected attempts as an audit history; each resubmission gets
    // its own payment row instead of overwriting the previous evidence.
    const result = await db.from('payments').insert(payment)
    if (result.error) throw result.error
    const { error: registrationUpdateError } = await db.from('registrations').update({ payment_status: 'Payment Under Review' }).eq('id', registration.id)
    if (registrationUpdateError) throw registrationUpdateError
    const { error: auditError } = await db.from('audit_logs').insert({ action: 'payment_evidence_submitted', registration_id: registration.id, details: { has_receipt: Boolean(receiptPath), has_transaction_reference: Boolean(transactionReference) } })
    if (auditError) throw auditError
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, status: 'Payment Under Review' }) }
  } catch (error) {
    if (uploadedPath) await db.storage.from('payment-receipts').remove([uploadedPath]).catch(() => undefined)
    console.error('payment evidence submission failed', error)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not submit payment evidence. Please try again or contact the event team.' }) }
  }
}
