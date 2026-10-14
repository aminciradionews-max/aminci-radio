import test from 'node:test'
import assert from 'node:assert/strict'
import { canDownloadTicket, hasDuplicate, isValidEmail, isValidPhone, makeTicketToken, nextCheckIn } from '../src/domain.js'

test('phone and email validation handles optional email', () => {
  assert.equal(isValidPhone('+2348012345678'), true)
  assert.equal(isValidPhone('123'), false)
  assert.equal(isValidEmail(''), true)
  assert.equal(isValidEmail('person@example.com'), true)
  assert.equal(isValidEmail('person@invalid'), false)
})
test('duplicate checks match phone and case-insensitive email', () => {
  const rows = [{ phone: '08012345678', email: 'A@Example.com' }]
  assert.equal(hasDuplicate(rows, '08012345678', ''), true)
  assert.equal(hasDuplicate(rows, '08099999999', 'a@example.COM'), true)
  assert.equal(hasDuplicate(rows, '08099999999', ''), false)
})
test('only paid registrations can download tickets', () => {
  assert.equal(canDownloadTicket({ status: 'Pending Payment' }), false)
  assert.equal(canDownloadTicket({ status: 'Paid — Verified' }), true)
})
test('ticket token is opaque and non-guessable in shape', () => {
  const token = makeTicketToken()
  assert.match(token, /^[a-f0-9]{64}$/)
  assert.notEqual(token, 'AM-1234567890')
})
test('check-in rejects unpaid, cancelled, and repeated entries', () => {
  assert.equal(nextCheckIn({ status: 'Pending Payment' }).result, 'PAYMENT NOT VERIFIED')
  assert.equal(nextCheckIn({ status: 'Cancelled' }).result, 'TICKET CANCELLED')
  assert.deepEqual(nextCheckIn({ status: 'Paid — Verified', checkedIn: '2026-10-14T10:00:00Z' }), { result: 'ALREADY CHECKED IN', checkedIn: '2026-10-14T10:00:00Z' })
  assert.equal(nextCheckIn({ status: 'Paid — Verified' }, '2026-10-14T11:00:00Z').checkedIn, '2026-10-14T11:00:00Z')
})
