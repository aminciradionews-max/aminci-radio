export const isValidPhone = value => /^\+?[0-9]{10,15}$/.test(String(value).replace(/\s/g, ''))
export const isValidEmail = value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))
export const hasDuplicate = (rows, phone, email) => rows.some(r => r.phone === phone || (email && String(r.email || '').toLowerCase() === String(email).toLowerCase()))
export const makeReference = () => `AM-${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`
export const makeTicketToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('')
export const nextCheckIn = (registration, time = new Date().toISOString()) => {
  if (registration.checkedIn) return { result: 'ALREADY CHECKED IN', checkedIn: registration.checkedIn }
  if (registration.status === 'Cancelled') return { result: 'TICKET CANCELLED' }
  if (registration.status !== 'Paid — Verified') return { result: 'PAYMENT NOT VERIFIED' }
  return { result: 'VALID TICKET — PAYMENT VERIFIED', checkedIn: time }
}
export const canDownloadTicket = registration => registration.status === 'Paid — Verified'
