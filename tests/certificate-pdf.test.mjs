import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { buildCertificatePdf } from '../src/certificate-pdf.ts'

const branding = {
  stationName: 'AMINCI RADIO 103.9 FM KANO',
  stationAddress: 'No. 71 Sharada Industrial Area Kano, Nigeria',
  stationPhone: '+234 902 555 5800',
  stationWebsite: 'www.aminciradio.com.ng',
  socialLinks: {},
  certificateLogoUrl: '/aminci-radio.jpg',
  watermarkEnabled: true,
  watermarkText: 'AMINCI RADIO 103.9 FM KANO · OFFICIAL CERTIFICATE',
  watermarkOpacity: 0.075,
  watermarkFontSize: 7,
  watermarkAngle: -28,
  watermarkSpacing: 64,
  watermarkColor: '#c5ad44',
  securityBorderEnabled: true,
}

const participants = [
  { name: 'Amina Yusuf', registrationId: 'AM-QA-SHORT' },
  { name: 'Salisu Idris Madobi Dutse', registrationId: 'AM-QA-MEDIUM' },
  { name: 'Abubakar Muhammad Abdullahi Ibrahim Sani', registrationId: 'AM-QA-LONG' },
]

for (const participant of participants) {
  test(`creates a valid A4 landscape preview for ${participant.registrationId}`, async () => {
    const bytes = await buildCertificatePdf({
      ...participant,
      certificateNumber: `PREVIEW-${participant.registrationId}`,
      token: '',
      eventDate: '31 October 2026 · 10:00am',
      venue: 'Aminci Radio, No. 71 Sharada Industrial Area Kano, Nigeria',
    }, branding, 'https://aminciradio.netlify.app', undefined, true)
    const pdf = await PDFDocument.load(bytes)
    assert.equal(pdf.getPageCount(), 1)
    assert.ok(Math.abs(pdf.getPages()[0].getWidth() - 841.89) < 0.1)
    assert.ok(Math.abs(pdf.getPages()[0].getHeight() - 595.28) < 0.1)
    assert.ok(bytes.length > 10_000)
  })
}

test('watermark can be disabled without changing page dimensions', async () => {
  const participant = { name: 'Preview Participant', registrationId: 'AM-QA-WATERMARK' }
  const data = { ...participant, certificateNumber: 'PREVIEW', token: '', eventDate: '31 October 2026', venue: 'Aminci Radio, Kano' }
  const enabled = await buildCertificatePdf(data, branding, 'https://aminciradio.netlify.app', undefined, true)
  const disabled = await buildCertificatePdf(data, { ...branding, watermarkEnabled: false }, 'https://aminciradio.netlify.app', undefined, true)
  assert.ok(enabled.length > disabled.length)
  for (const bytes of [enabled, disabled]) {
    const pdf = await PDFDocument.load(bytes)
    assert.equal(pdf.getPageCount(), 1)
    assert.ok(Math.abs(pdf.getPages()[0].getWidth() - 841.89) < 0.1)
    assert.ok(Math.abs(pdf.getPages()[0].getHeight() - 595.28) < 0.1)
  }
})
