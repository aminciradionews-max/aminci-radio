import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import QRCode from 'qrcode'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { supabase } from './supabase.js'
import { canDownloadTicket, hasDuplicate, isValidEmail, isValidPhone, makeReference, makeTicketToken, nextCheckIn } from './domain.js'
import './styles.css'

type Registration = { id: string; dbId?: string; name: string; phone: string; email: string; gender: string; age: number; residentialAddress: string; deviceType: string; state: string; lga: string; occupation: string; interests: string; status: 'Pending Payment' | 'Payment Under Review' | 'Paid — Verified' | 'Payment Rejected' | 'Cancelled'; date: string; reference?: string; checkedIn?: string; accessToken?: string; ticketToken?: string; transactionReference?: string; evidenceStatus?: string; rejectionReason?: string; receiptAvailable?: boolean }
const KEY = 'aminci-registrations-v1'
const readRows = (): Registration[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') as Registration[] } catch { return [] } }
const saveRows = (rows: Registration[]) => localStorage.setItem(KEY, JSON.stringify(rows))
const money = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })
const initialSettings = { eventDate: '31 October 2026', deadline: '27 October 2026', venue: 'Aminci Radio Sharada, Kwanar Ganduje, Sharada Industrial Area along Ilera Agro', time: '10:00am', bank: 'GTBank', account: 'Aminci Network Technology (Aminci Radio)', number: '0558087985', reference: '', instructions: 'Transfer ₦5,000 and keep your receipt. Your ticket becomes available after an administrator independently verifies the payment.', contact: '080336828125, 09048736532', open: true }
const Logo = ({ small = false }: { small?: boolean }) => <img className={small ? 'logo small' : 'logo'} src="/aminci-radio.jpg" alt="Aminci Radio 103.9 FM Kano" />
function App() {
  const [page, setPage] = useState<'home'|'register'|'portal'|'admin'|'checkin'>(() => new URLSearchParams(location.search).get('reset-password') === '1' ? 'admin' : location.hash.startsWith('#access=') ? 'portal' : 'home')
  const [rows, setRows] = useState(readRows)
  const [settings, setSettings] = useState(() => ({ ...initialSettings, ...(JSON.parse(localStorage.getItem('aminci-settings') || '{}') as Partial<typeof initialSettings>) }))
  const [registered, setRegistered] = useState<Registration | null>(null)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [admin, setAdmin] = useState(false)
  const [staffRole, setStaffRole] = useState<'admin'|'finance'|'checkin'|null>(null)
  const [staffEmail, setStaffEmail] = useState('')
  const [staffPassword, setStaffPassword] = useState('')
  const [passwordRecovery, setPasswordRecovery] = useState(() => new URLSearchParams(location.search).get('reset-password') === '1')
  const [newStaffPassword, setNewStaffPassword] = useState('')
  const [confirmStaffPassword, setConfirmStaffPassword] = useState('')
  const [staffBusy, setStaffBusy] = useState(false)
  const [scan, setScan] = useState('')
  const [proof, setProof] = useState<Record<string, string>>(() => JSON.parse(localStorage.getItem('aminci-proofs') || '{}') as Record<string,string>)
  const [ticketTokens, setTicketTokens] = useState<Record<string,string>>(() => JSON.parse(localStorage.getItem('aminci-ticket-tokens') || '{}') as Record<string,string>)
  const [participantAccessToken, setParticipantAccessToken] = useState(() => location.hash.startsWith('#access=') ? decodeURIComponent(location.hash.slice(8)) : localStorage.getItem('aminci-participant-access') || '')
  const [portalRefresh, setPortalRefresh] = useState(0)
  const [evidenceBusy, setEvidenceBusy] = useState(false)
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting'|'live'|'reconnecting'>('connecting')
  const [selectedParticipant, setSelectedParticipant] = useState<Registration | null>(null)
  const [selectedReceiptUrl, setSelectedReceiptUrl] = useState('')
  const supabaseReady = Boolean(supabase)
  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { setPasswordRecovery(true); setPage('admin') }
    })
    return () => subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!participantAccessToken || page !== 'portal' || !supabase) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/.netlify/functions/participant-portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: participantAccessToken }) })
        const body = await response.json() as { registration?: Registration; ticketToken?: string; paymentEvidence?: { transactionReference: string; status: string; rejectionReason: string }; settings?: Partial<typeof initialSettings>; error?: string }
        if (!response.ok || !body.registration) throw new Error(body.error || 'Could not retrieve this registration.')
        if (cancelled) return
        setRegistered({ ...body.registration, accessToken: participantAccessToken, ticketToken: body.ticketToken, transactionReference: body.paymentEvidence?.transactionReference, evidenceStatus: body.paymentEvidence?.status, rejectionReason: body.paymentEvidence?.rejectionReason })
        if (body.settings) setSettings(s => ({ ...s, ...body.settings }))
        setNotice('')
      } catch (error) { if (!cancelled) setNotice(error instanceof Error ? error.message : 'Could not retrieve this registration.') }
    })()
    return () => { cancelled = true }
  }, [participantAccessToken, page, portalRefresh])
  const updateRows = (next: Registration[]) => { setRows(next); saveRows(next) }
  const updateSettings = (next: typeof settings) => { setSettings(next); localStorage.setItem('aminci-settings', JSON.stringify(next)) }
  const loadStaffRecords = async () => {
    if (!supabase) throw new Error('Supabase is not configured for this deployment.')
    const pageSize = 500
    const data: Array<{ id: string; reference: string; full_name: string; phone: string; email: string|null; gender: string|null; age: number|null; residential_address: string|null; device_type: string|null; state: string; lga: string; occupation: string|null; interests: string; payment_status: Registration['status']; created_at: string }> = []
    for (let offset = 0; ; offset += pageSize) {
      const page = await supabase.from('registrations').select('id,reference,full_name,phone,email,gender,age,residential_address,device_type,state,lga,occupation,interests,payment_status,created_at').order('created_at', { ascending: false }).range(offset, offset + pageSize - 1)
      if (page.error) throw page.error
      data.push(...(page.data || []))
      if (!page.data || page.data.length < pageSize) break
    }
    const payments: Array<{ registration_id: string; transaction_reference: string|null; receipt_path: string|null; status: string; rejection_reason: string|null; submitted_at: string }> = []
    for (let offset = 0; ; offset += pageSize) {
      const page = await supabase.from('payments').select('registration_id,transaction_reference,receipt_path,status,rejection_reason,submitted_at').order('submitted_at', { ascending: false }).range(offset, offset + pageSize - 1)
      if (page.error) throw page.error
      payments.push(...(page.data || []))
      if (!page.data || page.data.length < pageSize) break
    }
    const latestEvidence = new Map<string, { transactionReference: string; receiptAvailable: boolean; status: string; rejectionReason: string }>()
    for (const payment of payments || []) if (!latestEvidence.has(payment.registration_id)) latestEvidence.set(payment.registration_id, { transactionReference: payment.transaction_reference || '', receiptAvailable: Boolean(payment.receipt_path), status: payment.status, rejectionReason: payment.rejection_reason || '' })
    const liveRows: Registration[] = data.map((r) => { const evidence = latestEvidence.get(r.id); return { dbId: r.id, id: r.reference, reference: r.reference, name: r.full_name, phone: r.phone, email: r.email || '', gender: r.gender || '', age: r.age || 0, residentialAddress: r.residential_address || '', deviceType: r.device_type || '', state: r.state, lga: r.lga, occupation: r.occupation || '', interests: r.interests, status: r.payment_status, date: r.created_at, transactionReference: evidence?.transactionReference, receiptAvailable: evidence?.receiptAvailable, evidenceStatus: evidence?.status, rejectionReason: evidence?.rejectionReason } })
    setRows(liveRows)
    const { data: event, error: settingsError } = await supabase.from('event_settings').select('event_date,deadline,venue,event_time,bank_name,account_name,account_number,payment_reference,payment_instructions,support_contact,registration_open').eq('id', 1).maybeSingle()
    if (settingsError) throw settingsError
    if (event) setSettings({ eventDate: event.event_date || '', deadline: event.deadline || '', venue: event.venue || '', time: event.event_time || '', bank: event.bank_name || '', account: event.account_name || '', number: event.account_number || '', reference: event.payment_reference || '', instructions: event.payment_instructions || '', contact: event.support_contact || '', open: event.registration_open })
  }
  useEffect(() => {
    const client = supabase
    if (!client || !supabaseReady || !admin || page !== 'admin') return
    let disposed = false
    let realtimeConnected = false
    let refreshing = false
    let debounceTimer: number | undefined
    const refreshRecords = async () => {
      if (disposed || refreshing) return
      refreshing = true
      try { await loadStaffRecords() }
      catch (error) { if (!disposed) setNotice(error instanceof Error ? error.message : 'Could not refresh registrations.') }
      finally { refreshing = false }
    }
    const queueRefresh = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => void refreshRecords(), 250)
    }
    const channel = client.channel('aminci-staff-live-registrations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, queueRefresh)
      .subscribe(status => {
        if (disposed) return
        if (status === 'SUBSCRIBED') {
          realtimeConnected = true
          setRealtimeStatus('live')
          void refreshRecords()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          realtimeConnected = false
          setRealtimeStatus('reconnecting')
        }
      })
    const fallbackTimer = window.setInterval(() => { if (!realtimeConnected) void refreshRecords() }, 30000)
    return () => {
      disposed = true
      if (debounceTimer) window.clearTimeout(debounceTimer)
      window.clearInterval(fallbackTimer)
      void client.removeChannel(channel)
    }
  }, [admin, page, supabaseReady])
  const signInStaff = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!supabase) { setNotice('Supabase is not configured for this deployment.'); return }
    setStaffBusy(true); setNotice('')
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: staffEmail.trim(), password: staffPassword })
      if (error || !data.user) throw new Error('Sign-in failed. Check your email and password.')
      const { data: profile, error: profileError } = await supabase.from('profiles').select('full_name,role,active').eq('id', data.user.id).maybeSingle()
      if (profileError) throw profileError
      if (!profile?.active || !['admin','finance','checkin'].includes(profile.role)) {
        await supabase.auth.signOut()
        throw new Error('This account does not have an active staff profile. Ask an administrator to grant staff access.')
      }
      setStaffRole(profile.role as 'admin'|'finance'|'checkin')
      await loadStaffRecords()
      setAdmin(true); setStaffPassword(''); setNotice('')
    } catch (error) {
      if (supabase) await supabase.auth.signOut()
      setNotice(error instanceof Error ? error.message : 'Could not sign in. Please try again.')
    } finally { setStaffBusy(false) }
  }
  const requestPasswordReset = async () => {
    if (!supabase) { setNotice('Supabase is not configured for this deployment.'); return }
    if (!staffEmail.trim()) { setNotice('Enter your staff email first, then request a password reset.'); return }
    setStaffBusy(true); setNotice('')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(staffEmail.trim(), { redirectTo: `${location.origin}/?reset-password=1` })
      if (error) throw error
      setNotice('If this email belongs to a staff account, Supabase will send a password-reset link. Check your inbox and spam folder.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not request a password reset. Please try again.') }
    finally { setStaffBusy(false) }
  }
  const updateStaffPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!supabase) { setNotice('Supabase is not configured for this deployment.'); return }
    if (newStaffPassword.length < 12) { setNotice('Use a password with at least 12 characters.'); return }
    if (newStaffPassword !== confirmStaffPassword) { setNotice('The passwords do not match.'); return }
    setStaffBusy(true); setNotice('')
    try {
      const { error } = await supabase.auth.updateUser({ password: newStaffPassword })
      if (error) throw error
      await supabase.auth.signOut()
      setPasswordRecovery(false); setNewStaffPassword(''); setConfirmStaffPassword(''); setStaffPassword('')
      window.history.replaceState({}, document.title, window.location.pathname)
      setNotice('Password updated. Sign in using your new password.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not update the password. Request a new reset link.') }
    finally { setStaffBusy(false) }
  }
  const runStaffAction = async (action: string, registrationId?: string, reason?: string) => {
    if (!supabase || !registrationId) return false
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Your session has expired. Sign in again.')
      const response = await fetch('/.netlify/functions/admin-action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action, registrationId, reason }) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'The action could not be completed.')
      await loadStaffRecords(); setNotice(''); return true
    } catch (error) { setNotice(error instanceof Error ? error.message : 'The staff action could not be completed.'); return false }
  }
  const issueParticipantAccess = async (registrationId?: string) => {
    if (!supabase || !registrationId) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Your session has expired. Sign in again.')
      const response = await fetch('/.netlify/functions/admin-action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: 'issue_participant_access', registrationId }) })
      const result = await response.json() as { accessToken?: string; error?: string }
      if (!response.ok || !result.accessToken) throw new Error(result.error || 'Could not issue a participant link.')
      const link = `${location.origin}/#access=${result.accessToken}`
      await navigator.clipboard.writeText(link)
      setNotice('A new private participant link was copied. Share it only with this participant; any previous link is now invalid.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not issue a participant link.') }
  }
  const deleteRegistration = async (registration: Registration) => {
    if (!supabase || staffRole !== 'admin' || !registration.dbId) return
    const reason = window.prompt(`Reason for permanently deleting ${registration.name} (${registration.id})?`)
    if (!reason?.trim()) return
    const confirmed = window.confirm(`Permanently delete ${registration.name} (${registration.id}) and its payment, ticket, and check-in records? This cannot be undone. The audit record will remain.`)
    if (!confirmed) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Your session has expired. Sign in again.')
      const response = await fetch('/.netlify/functions/admin-action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: 'delete_registration', registrationId: registration.dbId, reason }) })
      const result = await response.json() as { deleted?: string; error?: string }
      if (!response.ok || !result.deleted) throw new Error(result.error || 'Could not delete the registration.')
      await loadStaffRecords()
      setNotice(`Registration ${result.deleted} was deleted. The action is recorded in the audit log.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not delete the registration.') }
  }
  const openPaymentReceipt = async (registrationId?: string) => {
    if (!supabase || !registrationId) return
    setSelectedReceiptUrl('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Your session has expired. Sign in again.')
      const response = await fetch('/.netlify/functions/admin-action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: 'get_payment_receipt', registrationId }) })
      const result = await response.json() as { url?: string; error?: string }
      if (!response.ok || !result.url) throw new Error(result.error || 'Could not open the receipt.')
      setSelectedReceiptUrl(result.url)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not open the receipt.') }
  }
  const saveStaffSettings = async (next: typeof initialSettings) => {
    updateSettings(next)
    if (!supabase) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setNotice('Your session has expired. Sign in again.'); return }
    const response = await fetch('/.netlify/functions/admin-action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: 'save_settings', settings: { event_date: next.eventDate, deadline: next.deadline, venue: next.venue, event_time: next.time, bank_name: next.bank, account_name: next.account, account_number: next.number, payment_reference: next.reference, payment_instructions: next.instructions, support_contact: next.contact, registration_open: next.open } }) })
    const result = await response.json() as { error?: string }
    if (!response.ok) setNotice(result.error || 'Could not save event settings.')
    else setNotice('Event settings saved.')
  }
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const form = new FormData(e.currentTarget)
    const name = String(form.get('name') || '').trim(); const phone = String(form.get('phone') || '').replace(/\s/g, '')
    const email = String(form.get('email') || '').trim();
    if (!isValidPhone(phone)) return setNotice('Enter a valid phone number (10–15 digits).')
    if (!isValidEmail(email)) return setNotice('Enter a valid email address.')
    if (hasDuplicate(rows, phone, email)) return setNotice('A registration already exists with that phone number or email. Contact the organizers if you need help.')
    const payload = { name, phone, email, gender: String(form.get('gender') || ''), age: Number(form.get('age')), residentialAddress: String(form.get('residentialAddress') || '').trim(), deviceType: String(form.get('deviceType') || ''), state: String(form.get('state') || ''), lga: String(form.get('lga') || ''), occupation: String(form.get('occupation') || ''), interests: String(form.get('interests') || '') }
    if (supabaseReady) {
      try { const response = await fetch('/.netlify/functions/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }); const body = await response.json() as { registration?: Registration; participantAccessToken?: string; error?: string }; if (!response.ok || !body.registration || !body.participantAccessToken) throw new Error(body.error || 'Registration failed'); const registration = { ...body.registration, accessToken: body.participantAccessToken }; setRegistered(registration); setParticipantAccessToken(body.participantAccessToken); localStorage.setItem('aminci-participant-access', body.participantAccessToken); setPage('portal'); return }
      catch (err) { setNotice(err instanceof Error ? err.message : 'Registration service unavailable. Please try again.') ; return }
    }
    const row: Registration = { ...payload, id: makeReference(), status: 'Pending Payment', date: new Date().toISOString() }
    updateRows([row, ...rows]); setRegistered(row); setPage('portal'); setNotice('')
  }
  const mark = (id: string, status: Registration['status']) => { if (status === 'Paid — Verified') { const token = makeTicketToken(); const next = {...ticketTokens,[id]:token}; setTicketTokens(next); localStorage.setItem('aminci-ticket-tokens',JSON.stringify(next)) } updateRows(rows.map(r => r.id === id ? { ...r, status } : r)) }
  const submitProof = (id: string, value: string) => { const p = {...proof, [id]: value}; setProof(p); localStorage.setItem('aminci-proofs', JSON.stringify(p)); setNotice('Evidence submitted for administrator review. Payment is not marked as verified.') }
  const submitPaymentEvidence = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!registered || !participantAccessToken) return
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const transactionReference = String(form.get('transactionReference') || '').trim()
    const file = form.get('receipt')
    const receipt = file instanceof File && file.size ? file : null
    if (!transactionReference && !receipt) { setNotice('Enter the transfer reference or attach your receipt.'); return }
    if (transactionReference.length > 100) { setNotice('Transaction reference must be 100 characters or fewer.'); return }
    if (receipt && receipt.size > 2 * 1024 * 1024) { setNotice('Receipt file must be no larger than 2 MB.'); return }
    setEvidenceBusy(true); setNotice('')
    try {
      let fileBase64: string | undefined
      if (receipt) fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
        reader.onerror = () => reject(new Error('Could not read the receipt file.'))
        reader.readAsDataURL(receipt)
      })
      const response = await fetch('/.netlify/functions/submit-payment-evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: participantAccessToken, transactionReference, fileName: receipt?.name, contentType: receipt?.type, fileBase64 }) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not submit payment evidence.')
      setRegistered(current => current ? { ...current, status: 'Payment Under Review', transactionReference, evidenceStatus: 'submitted', rejectionReason: '' } : current)
      setNotice('Payment evidence received. It remains under review until staff confirms the transfer.')
      formElement.reset()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not submit payment evidence. Please try again.') }
    finally { setEvidenceBusy(false) }
  }
  const downloadTicket = async (r: Registration) => {
    if (!canDownloadTicket(r)) return
    const token = r.ticketToken || ticketTokens[r.id]; if (!token) { setNotice('Your ticket is not ready in this session. Refresh your secure participant link and try again.'); return }
    const url = `${location.origin}/.netlify/functions/verify-ticket?token=${token}`; const qr = await QRCode.toDataURL(url, { width: 240, margin: 1 })
    const pdf = await PDFDocument.create(), page = pdf.addPage([540, 300]), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    page.drawRectangle({x:0,y:0,width:540,height:300,color:rgb(.99,.98,.93)}); page.drawRectangle({x:0,y:248,width:540,height:52,color:rgb(.96,.86,.2)})
    const logoBytes = await fetch('/aminci-radio.jpg').then(res=>res.arrayBuffer()); const logo = await pdf.embedJpg(logoBytes); page.drawImage(logo,{x:18,y:255,width:38,height:38})
    page.drawText('AMINCI RADIO 103.9 FM KANO',{x:67,y:272,size:14,font:bold}); page.drawText('DUNIYAR SOCIAL MEDIA TRAINING',{x:20,y:222,size:17,font:bold}); page.drawText('SOCIAL MEDIA, CYBERSECURITY & ARTIFICIAL INTELLIGENCE',{x:20,y:201,size:11,font})
    page.drawText(r.name,{x:20,y:162,size:18,font:bold}); page.drawText(`Registration ID: ${r.id}`,{x:20,y:139,size:11,font}); page.drawText('PAYMENT: PAID — VERIFIED',{x:20,y:118,size:12,font:bold,color:rgb(.18,.43,.22)})
    page.drawText(`Date: ${settings.eventDate || 'To be announced'}    Time: ${settings.time || 'To be announced'}`,{x:20,y:94,size:10,font}); page.drawText(`Venue: ${settings.venue || 'To be announced'}`,{x:20,y:75,size:10,font}); page.drawText('Present this ticket at the entrance.',{x:20,y:34,size:10,font})
    const image = await pdf.embedPng(qr); page.drawImage(image,{x:423,y:94,width:88,height:88}); page.drawText('SCAN TO VERIFY',{x:427,y:81,size:8,font:bold})
    const bytes = await pdf.save(), blob = new Blob([bytes as BlobPart],{type:'application/pdf'}), link = document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`${r.id}-ticket.pdf`; link.click(); URL.revokeObjectURL(link.href)
  }
  const filtered = useMemo(() => rows.filter(r => `${r.name} ${r.phone} ${r.email} ${r.id}`.toLowerCase().includes(query.toLowerCase())), [rows,query])
  const searched = rows.find(r => r.id.toLowerCase() === scan.trim().toLowerCase() || r.phone === scan.trim() || r.name.toLowerCase() === scan.trim().toLowerCase())
  const nav = (target: typeof page, label: string) => <button className={`nav-link ${page===target?'active':''}`} onClick={() => {setPage(target);setNotice('')}}>{label}</button>
  return <><header className="topbar"><button className="brand" onClick={() => setPage('home')}><Logo small/><span><b>AMINCI RADIO</b><small>103.9 FM · KANO</small></span></button><nav>{nav('home','Overview')}{nav('register','Register')}{nav('portal','My registration')}{nav('checkin','Check-in')}{nav('admin','Staff portal')}</nav><a className="header-cta" href="#register" onClick={e=>{e.preventDefault();setPage('register')}}>Register now <span>↗</span></a><button className="mobile-menu" onClick={()=>setPage('register')}>Register</button></header>
  <main>
    {page==='home' && <><section className="hero"><div className="hero-copy"><div className="eyebrow"><i/> ONE DAY · PRACTICAL TRAINING</div><h1>Make your digital<br/><em>world work</em> for you.</h1><p className="lead">Build confidence online. Learn to grow a social media presence, protect yourself from cyber threats, and use AI tools with purpose.</p><div className="hero-actions"><button className="primary" onClick={()=>setPage('register')}>Reserve your seat <span>→</span></button><span className="price-tag">Just <b>₦5,000</b> per person</span></div><div className="hero-meta"><span>◷ &nbsp; {settings.eventDate || 'Event date to be announced'}</span><span>⌖ &nbsp; {settings.venue || 'Kano · venue to be announced'}</span></div></div><div className="hero-visual"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-logo"><Logo/></div><div className="sticker">LEARN<br/><b>· DO ·</b><br/>GROW</div><div className="visual-caption"><b>DUNIYAR SOCIAL MEDIA</b><span>Digital skills for everyday life</span></div></div></section><section className="topic-strip"><span>WHAT YOU’LL LEARN</span><b>01 &nbsp; Social media management</b><b>02 &nbsp; Cybersecurity & online safety</b><b>03 &nbsp; Practical AI applications</b></section><section className="details-grid"><article><span className="section-kicker">THE EXPERIENCE</span><h2>Skills you can use<br/>the very next day.</h2><p>Practical, approachable sessions designed for creators, entrepreneurs, students, and anyone who wants to feel more capable online.</p><button className="text-button" onClick={()=>setPage('register')}>Save your place <span>→</span></button></article><aside className="transfer-card"><div className="card-top"><span className="icon-circle">₦</span><span className="status-pill">REGISTRATION OPEN</span></div><h3>Simple, secure registration.</h3><p>Pay by bank transfer, then keep your transaction receipt. Your ticket is issued once our team confirms your payment.</p><div className="fee-row"><span>Training fee</span><strong>₦5,000 <small>/ person</small></strong></div><button className="primary full" onClick={()=>setPage('register')}>Register for training <span>→</span></button></aside></section><section className="brand-foot"><Logo/><div><b>AMINCI RADIO 103.9 FM</b><span>In collaboration with <strong>Duniyar Social Media</strong></span></div><button onClick={()=>setPage('register')}>Join the training →</button></section></>}
    {page==='register' && <section className="form-layout"><div className="form-intro"><span className="section-kicker">YOUR NEXT STEP</span><h1>Save your<br/><em>seat.</em></h1><p>Complete the form to receive your registration reference and bank transfer instructions.</p><div className="mini-fee"><span>Registration fee</span><b>₦5,000</b><small>per participant</small></div></div><form className="registration-form" onSubmit={submit}><div className="form-heading"><span>01 — REGISTRATION</span><h2>Tell us about yourself</h2><p>Fields marked * are required.</p></div>{notice&&<div className="notice error">{notice}</div>}<label>Full name *<input name="name" required minLength={2} autoComplete="name" placeholder="e.g. Amina Yusuf"/></label><div className="form-row"><label>Phone number *<input name="phone" required type="tel" autoComplete="tel" placeholder="080 0000 0000"/></label><label>Gender *<select name="gender" required defaultValue=""><option value="" disabled>Select gender</option><option value="Female">Female</option><option value="Male">Male</option></select></label></div><div className="form-row"><label>Age *<input name="age" type="number" min="1" max="120" step="1" required placeholder="Your age"/></label><label>Are you using a PC or smartphone? *<select name="deviceType" required defaultValue=""><option value="" disabled>Select a device</option><option value="PC">PC</option><option value="Smartphone">Smartphone</option><option value="Both">Both</option></select></label></div><label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com"/></label><label>Residential address *<textarea name="residentialAddress" required maxLength={500} autoComplete="street-address" placeholder="Enter your residential address"/></label><div className="form-row"><label>State *<input name="state" required defaultValue="Kano" placeholder="Your state"/></label><label>Local government area *<input name="lga" required placeholder="Your LGA"/></label></div><div className="form-row"><label>Occupation / organization<input name="occupation" placeholder="What do you do?"/></label><label>Area of interest *<select name="interests" required defaultValue=""><option value="" disabled>Select a topic</option><option>Social Media</option><option>Cybersecurity</option><option>Artificial Intelligence</option><option>All Topics</option></select></label></div><label className="consent"><input type="checkbox" required/><span>I agree to be contacted about this training and confirm these details are accurate.</span></label><button className="primary full" disabled={!settings.open}>{settings.open?'Submit registration':'Registration is closed'} <span>→</span></button><p className="form-note">Your registration does not confirm payment. Your ticket becomes available only after an administrator verifies the payment.</p></form></section>}
    {page==='portal' && <section className="portal-page"><span className="section-kicker">PARTICIPANT PORTAL</span><h1>Your registration.</h1><p>View your reference, submit transfer evidence, and download your ticket after payment is verified.</p>{registered&&<><div className="success-card"><div className="success-mark">✓</div><div><b>Registration received, {registered.name.split(' ')[0]}.</b><span>Your reference number is <strong>{registered.id}</strong>. Save the secure link below to return to this page.</span><button className="text-button" onClick={()=>navigator.clipboard?.writeText(`${location.origin}/#access=${registered.accessToken || participantAccessToken}`)}>Copy secure participant link</button></div><button className="copy-btn" onClick={()=>navigator.clipboard?.writeText(registered.id)}>Copy reference</button></div><article className="participant-card"><div><span className="section-kicker">REFERENCE · {registered.id}</span><h3>{registered.name}</h3><span className={`status-text ${registered.status==='Paid — Verified'?'paid':''}`}>{registered.status}</span></div><div className="payment-info"><b>Bank transfer · ₦5,000</b><span>{settings.bank?`${settings.bank} · ${settings.account} · ${settings.number}`:'Official bank details will be published by the organizer.'}</span><small>{settings.instructions}</small></div><div className="participant-actions"><button className="outline compact" onClick={()=>setPortalRefresh(v=>v+1)}>Refresh payment status</button>{registered.status==='Paid — Verified'?<button className="primary compact" onClick={()=>downloadTicket(registered)}>Download ticket ↓</button>:<span className="muted">Your ticket unlocks after staff verifies your payment.</span>}</div></article>{registered.status==='Payment Under Review'?<div className="notice evidence-status">Payment evidence{registered.transactionReference?` (reference ${registered.transactionReference})`:''} has been received and is awaiting administrator review. Submitting evidence does not automatically confirm payment.</div>:!['Paid — Verified','Cancelled'].includes(registered.status)&&<form className="evidence-form" onSubmit={submitPaymentEvidence}><span className="section-kicker">PAYMENT EVIDENCE</span><h3>Tell us about your transfer.</h3><p>Enter the bank transaction reference, attach your transfer receipt, or provide both. Receipts are stored privately for staff review.</p>{registered.status==='Payment Rejected'&&registered.rejectionReason&&<div className="notice">Previous evidence was rejected: {registered.rejectionReason}</div>}<label>Transaction reference <small>(optional if you attach a receipt)</small><input name="transactionReference" maxLength={100} defaultValue={registered.transactionReference || ''} placeholder="Reference shown on your bank receipt"/></label><label>Transfer receipt <small>(JPG, PNG, or PDF · maximum 2 MB)</small><input name="receipt" type="file" accept="image/jpeg,image/png,application/pdf"/></label><small className="muted">Your payment remains pending until an authorized administrator independently confirms the transfer.</small><button className="primary compact" type="submit" disabled={evidenceBusy}>{evidenceBusy?'Sending evidence…':'Submit evidence for review →'}</button></form>}</>}{supabaseReady&&!registered&&<div className="notice">Open the private participant link saved after registration. If you have lost it, contact the event team to request a replacement.</div>}{!supabaseReady&&<><div className="portal-search"><label>Find a registration by reference or phone<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="e.g. AM-7F31A2C8D4"/></label></div><div className="participant-list">{rows.filter(r=>!query||`${r.id} ${r.phone}`.toLowerCase().includes(query.toLowerCase())).map(r=><article className="participant-card" key={r.id}><div><span className="section-kicker">REFERENCE · {r.id}</span><h3>{r.name}</h3><span className={`status-text ${r.status==='Paid — Verified'?'paid':''}`}>{r.status}</span></div><div className="payment-info"><b>Bank transfer · ₦5,000</b><span>{settings.bank?`${settings.bank} · ${settings.account} · ${settings.number}`:'Official bank details will be published by the organizer.'}</span><small>{settings.reference}</small></div><div className="participant-actions">{r.status==='Paid — Verified'?<button className="primary compact" onClick={()=>downloadTicket(r)}>Download ticket ↓</button>:<><button className="outline compact" onClick={()=>{const ref=prompt('Enter the bank transfer transaction reference');if(ref)submitProof(r.id,ref)}}>Submit transfer reference</button><span className="muted">Ticket unlocks after staff verification</span></>}</div></article>)}{rows.length===0&&!supabaseReady&&<div className="empty-state"><span>◌</span><b>No registration found yet.</b><button className="text-button" onClick={()=>setPage('register')}>Register now →</button></div>}</div></>}{!registered&&<button className="outline" onClick={()=>setPage('register')}>Start a registration</button>}{notice&&<div className="notice">{notice}</div>}</section>}
    {page==='admin' && <section className="admin-page">{!admin?<form className="login-card" onSubmit={passwordRecovery?updateStaffPassword:signInStaff}><span className="section-kicker">AUTHORIZED STAFF ONLY</span><h1>{passwordRecovery?'Set a new password':'Staff sign in'}</h1><p>{passwordRecovery?'Choose a new password for your Supabase staff account.':'Sign in with the email and password for your authorized Supabase staff account.'}</p>{passwordRecovery?<><label>New password<input type="password" autoComplete="new-password" minLength={12} required value={newStaffPassword} onChange={e=>setNewStaffPassword(e.target.value)} placeholder="At least 12 characters"/></label><label>Confirm new password<input type="password" autoComplete="new-password" minLength={12} required value={confirmStaffPassword} onChange={e=>setConfirmStaffPassword(e.target.value)} placeholder="Enter the new password again"/></label><button className="primary full" type="submit" disabled={staffBusy || !supabaseReady}>{staffBusy?'Updating…':'Update password →'}</button></>:<><label>Email<input type="email" id="staff-email" autoComplete="username" required value={staffEmail} onChange={e=>setStaffEmail(e.target.value)} placeholder="staff@example.com"/></label><label>Password<input type="password" id="staff-pass" autoComplete="current-password" required value={staffPassword} onChange={e=>setStaffPassword(e.target.value)} placeholder="Your password"/></label><button className="primary full" type="submit" disabled={staffBusy || !supabaseReady}>{staffBusy?'Signing in…':supabaseReady?'Sign in securely →':'Supabase is not configured'}</button><button type="button" className="text-button" disabled={staffBusy || !supabaseReady} onClick={()=>void requestPasswordReset()}>Forgot password?</button>{!supabaseReady&&<button type="button" className="text-button" onClick={()=>{setAdmin(true);setStaffRole(null)}}>Open local preview dashboard</button>}</>}{notice&&<div className="notice">{notice}</div>}</form>:<><div className="admin-heading"><div><span className="section-kicker">AMINCI · STAFF DASHBOARD · {staffRole?.toUpperCase() || 'LOCAL PREVIEW'}</span><h1>Registrations</h1><span className={`realtime-indicator ${realtimeStatus}`}><i/>{realtimeStatus==='live'?'Live updates on':'Reconnecting · 30s fallback'}</span></div><button className="outline" onClick={async()=>{if(supabase)await supabase.auth.signOut();setAdmin(false);setStaffRole(null);setRows(readRows());setNotice('')}}>Sign out</button></div>{notice&&<div className="notice">{notice}</div>}<div className="stats-grid"><div><span>Registrations</span><b>{rows.length}</b></div><div><span>Paid · verified</span><b>{rows.filter(r=>r.status==='Paid — Verified').length}</b></div><div><span>Pending review</span><b>{rows.filter(r=>r.status==='Payment Under Review').length}</b></div><div><span>Confirmed revenue</span><b>{money.format(rows.filter(r=>r.status==='Paid — Verified').length*5000)}</b></div></div><div className="admin-toolbar"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, phone, email or ID"/><button className="outline" onClick={()=>{const csv=['ID,Name,Phone,Email,Gender,Age,Residential Address,Device,State,LGA,Occupation,Interest,Status,Registered',...filtered.map(r=>[r.id,r.name,r.phone,r.email,r.gender,r.age || '',r.residentialAddress,r.deviceType,r.state,r.lga,r.occupation,r.interests,r.status,r.date].map(v=>'"'+String(v).replaceAll('"','""')+'"').join(','))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='aminci-registrations.csv';a.click()}}>Export CSV ↓</button></div>{filtered.map(r=><article className="admin-row" key={r.id}><div><b>{r.name}</b><span>{r.id} · {r.phone} · {r.email || 'No email'}</span><small>{r.gender && `${r.gender} · `}{r.state}, {r.lga} · {r.interests} · {new Date(r.date).toLocaleDateString()}</small>{(r.transactionReference||r.receiptAvailable)&&<small>Payment evidence: {r.evidenceStatus}{r.transactionReference?` · Transfer reference: ${r.transactionReference}`:''}</small>}{r.rejectionReason&&<small>Rejection reason: {r.rejectionReason}</small>}<div className="participant-review-actions"><button className="outline compact" onClick={()=>{setSelectedParticipant(r);setSelectedReceiptUrl('')}}>View participant details</button>{['admin','finance'].includes(staffRole || '')&&r.receiptAvailable&&<button className="primary compact" onClick={()=>{setSelectedParticipant(r);setSelectedReceiptUrl('');void openPaymentReceipt(r.dbId)}}>Review receipt</button>}{['admin','finance'].includes(staffRole || '')&&!r.receiptAvailable&&(r.transactionReference||r.status==='Payment Under Review')&&<button className="primary compact" onClick={()=>{setSelectedParticipant(r);setSelectedReceiptUrl('')}}>Review payment</button>}</div>{proof[r.id]&&<small>Submitted transfer reference: {proof[r.id]}</small>}</div><span className={'status-badge '+(r.status==='Paid — Verified'?'green':'')}>{r.status}</span><div className="row-actions">{(!supabaseReady || staffRole==='admin' || staffRole==='finance')&&<><button onClick={()=>supabaseReady?void runStaffAction('verify_payment',r.dbId):mark(r.id,'Paid — Verified')}>Confirm paid</button><button onClick={()=>{const reason=window.prompt('Enter the reason for rejecting this payment');if(reason?.trim())supabaseReady?void runStaffAction('reject_payment',r.dbId,reason):mark(r.id,'Payment Rejected')}}>Reject</button></>}{(!supabaseReady || staffRole==='admin')&&<button onClick={()=>{const reason=window.prompt('Enter the reason for cancelling this ticket');if(reason?.trim())supabaseReady?void runStaffAction('revoke_ticket',r.dbId,reason):mark(r.id,'Cancelled')}}>Cancel</button>}{supabaseReady&&staffRole==='admin'&&<><button onClick={()=>void issueParticipantAccess(r.dbId)}>Issue secure link</button><button className="delete-registration" onClick={()=>void deleteRegistration(r)}>Delete</button></>}</div></article>)}{selectedParticipant&&<div className="participant-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget){setSelectedParticipant(null);setSelectedReceiptUrl('')}}}><section className="participant-modal" role="dialog" aria-modal="true" aria-labelledby="participant-modal-title"><div className="participant-modal-heading"><div><span className="section-kicker">PARTICIPANT RECORD · {selectedParticipant.id}</span><h2 id="participant-modal-title">{selectedParticipant.name}</h2><span className={'status-badge '+(selectedParticipant.status==='Paid — Verified'?'green':'')}>{selectedParticipant.status}</span></div><button className="outline" onClick={()=>{setSelectedParticipant(null);setSelectedReceiptUrl('')}} aria-label="Close participant details">Close</button></div><div className="participant-detail-grid"><div><small>Phone</small><b>{selectedParticipant.phone}</b></div><div><small>Email</small><b>{selectedParticipant.email||'Not provided'}</b></div><div><small>Gender</small><b>{selectedParticipant.gender||'Not provided'}</b></div><div><small>Age</small><b>{selectedParticipant.age||'Not provided'}</b></div><div><small>Residential address</small><b>{selectedParticipant.residentialAddress||'Not provided'}</b></div><div><small>Device</small><b>{selectedParticipant.deviceType||'Not provided'}</b></div><div><small>State</small><b>{selectedParticipant.state||'Not provided'}</b></div><div><small>Local government area</small><b>{selectedParticipant.lga||'Not provided'}</b></div><div><small>Occupation / organization</small><b>{selectedParticipant.occupation||'Not provided'}</b></div><div><small>Training interests</small><b>{selectedParticipant.interests||'Not provided'}</b></div><div><small>Registration date</small><b>{new Date(selectedParticipant.date).toLocaleString()}</b></div><div><small>Transfer reference</small><b>{selectedParticipant.transactionReference||'Not submitted'}</b></div><div><small>Evidence status</small><b>{selectedParticipant.evidenceStatus||'No evidence submitted'}</b></div>{selectedParticipant.rejectionReason&&<div className="detail-wide"><small>Payment rejection reason</small><b>{selectedParticipant.rejectionReason}</b></div>}</div><div className="participant-modal-actions">{selectedParticipant.receiptAvailable&&['admin','finance'].includes(staffRole||'')&&<button className="outline compact" onClick={()=>void openPaymentReceipt(selectedParticipant.dbId)}>Reload uploaded receipt</button>}{selectedParticipant.status!=='Paid — Verified'&&selectedParticipant.status!=='Cancelled'&&['admin','finance'].includes(staffRole||'')&&<button className="primary compact" onClick={async()=>{if(window.confirm(`Confirm that ₦5,000 has arrived for ${selectedParticipant.name}?`)){const ok=await runStaffAction('verify_payment',selectedParticipant.dbId);if(ok)setSelectedParticipant(null)}}}>Confirm transfer received</button>}{selectedParticipant.status!=='Paid — Verified'&&['admin','finance'].includes(staffRole||'')&&<button className="outline compact" onClick={async()=>{const reason=window.prompt('Reason for rejecting this payment evidence');if(reason?.trim()){const ok=await runStaffAction('reject_payment',selectedParticipant.dbId,reason);if(ok)setSelectedParticipant(null)}}}>Reject evidence</button>}</div>{selectedReceiptUrl&&<div className="receipt-preview"><div className="receipt-preview-heading"><b>Private transfer receipt</b><a href={selectedReceiptUrl} target="_blank" rel="noreferrer">Open in new tab ↗</a></div>{selectedReceiptUrl.toLowerCase().includes('.pdf')?<iframe title="Payment receipt PDF" src={selectedReceiptUrl}/>:<img src={selectedReceiptUrl} alt="Participant's uploaded payment receipt"/>}</div>}</section></div>}{(!supabaseReady || staffRole==='admin')&&<SettingsPanel settings={settings} onSave={supabaseReady?saveStaffSettings:updateSettings}/>}<p className="demo-warning">{supabaseReady?'Staff access verified through Supabase. Payment and settings changes are sent to the protected server function.':'Local preview only: actions here are not authenticated or persisted to Supabase.'}</p></>}</section>}
    {page==='checkin' && <section className="checkin-page"><div className="checkin-top"><span className="section-kicker">EVENT DAY · ENTRY DESK</span><span className="live-pill"><i/> LIVE VERIFICATION</span></div><h1>Check in.</h1><p>Scan the QR code or search by registration ID, name, or phone number.</p><div className="scanner-card"><button className="scan-visual" onClick={()=>setNotice('Camera scanning uses a verified backend endpoint in the deployed app. Use manual lookup below in this local preview.')}><span>▦</span><b>Scan attendee QR</b><small>Allow camera access to begin scanning</small></button><div className="manual-search"><label>Manual lookup<input value={scan} onChange={e=>setScan(e.target.value)} placeholder="Registration ID or phone number" autoFocus/></label>{searched&&<div className={`verify-result ${searched.status==='Paid — Verified'?'valid':''}`}><div className="verify-state">{nextCheckIn(searched).result}</div><h2>{searched.name}</h2><span>{searched.id} · {searched.phone}</span><b>{searched.status}</b>{searched.checkedIn?<div className="notice error">ALREADY CHECKED IN · {new Date(searched.checkedIn).toLocaleString()}</div>:searched.status==='Paid — Verified'?<button className="primary full" onClick={()=>updateRows(rows.map(r=>r.id===searched.id?{...r,checkedIn:nextCheckIn(r).checkedIn}:r))}>Confirm check-in →</button>:<span className="muted">Do not admit until payment is verified.</span>}</div>}</div></div>{notice&&<div className="notice">{notice}</div>}<div className="checkin-foot">A record of each check-in should be written to the secure event log.</div></section>}
  </main><footer><span>© {new Date().getFullYear()} Aminci Radio 103.9 FM Kano</span><span>Digital confidence for everyone.</span><button onClick={()=>setPage('admin')}>Staff access</button></footer></>
}
function SettingsPanel({settings,onSave}:{settings:typeof initialSettings;onSave:(s:typeof initialSettings)=>void}) { const [draft,setDraft]=useState(settings); const change=(k:keyof typeof settings,v:string|boolean)=>setDraft({...draft,[k]:v}); return <details className="settings-panel"><summary>Event & payment settings</summary><div className="settings-grid">{(['eventDate','deadline','venue','time','bank','account','number','reference','contact'] as const).map(k=><label key={k}>{({eventDate:'Event date',deadline:'Registration deadline',venue:'Venue',time:'Time',bank:'Bank name',account:'Account name',number:'Account number',reference:'Payment reference',contact:'Support contact'} as Record<string,string>)[k]}<input value={draft[k]} onChange={e=>change(k,e.target.value)}/></label>)}<label className="span-two">Payment instructions<textarea value={draft.instructions} onChange={e=>change('instructions',e.target.value)}/></label><label className="toggle"><input type="checkbox" checked={draft.open} onChange={e=>change('open',e.target.checked)}/> Registration open</label></div><button className="primary compact" onClick={()=>onSave(draft)}>Save settings</button></details> }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
