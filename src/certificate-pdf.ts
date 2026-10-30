import QRCode from 'qrcode'
import { degrees, PDFDocument, PDFString, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib'

export type CertificateData = {
  certificateNumber: string
  token: string
  name: string
  registrationId: string
  eventDate: string
  venue: string
}

export type CertificateBranding = {
  stationName: string
  stationAddress: string
  stationPhone: string
  stationWebsite: string
  socialLinks: Record<string, string>
  certificateLogoUrl: string
  watermarkEnabled: boolean
  watermarkText: string
  watermarkOpacity: number
  watermarkFontSize: number
  watermarkAngle: number
  watermarkSpacing: number
  watermarkColor: string
  securityBorderEnabled: boolean
}

const PAGE_W = 841.89
const PAGE_H = 595.28
const socialOrder = ['facebook', 'instagram', 'youtube', 'tiktok', 'x', 'linkedin', 'whatsapp'] as const
const socialColor: Record<string, ReturnType<typeof rgb>> = {
  facebook: rgb(0.10, 0.36, 0.74), instagram: rgb(0.68, 0.20, 0.48), youtube: rgb(0.78, 0.12, 0.11),
  tiktok: rgb(0.10, 0.12, 0.15), x: rgb(0.10, 0.12, 0.15), linkedin: rgb(0.05, 0.39, 0.62), whatsapp: rgb(0.10, 0.57, 0.31)
}
const socialHosts: Record<(typeof socialOrder)[number], string[]> = {
  facebook: ['facebook.com'], instagram: ['instagram.com'], youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com'], x: ['x.com', 'twitter.com'], linkedin: ['linkedin.com'], whatsapp: ['whatsapp.com', 'wa.me']
}

export function configuredSocialAccounts(links: Record<string, string>) {
  return socialOrder.flatMap(platform => {
    const value = links?.[platform]?.trim()
    if (!value) return []
    try {
      const url = new URL(value)
      const officialHost = socialHosts[platform].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
      if (url.protocol !== 'https:' || !officialHost || url.username || url.password) return []
      return [{ platform, url: url.toString() }]
    } catch { return [] }
  })
}

export function certificateQrTarget(cert: CertificateData, baseUrl: string, preview = false) {
  return preview
    ? 'PREVIEW ONLY - NOT A VALID CERTIFICATE'
    : `${baseUrl}/.netlify/functions/verify-certificate?token=${encodeURIComponent(cert.token)}`
}

function hexColor(value: string, fallback = '#c5ad44') {
  const hex = /^#[\da-f]{6}$/i.test(value) ? value.slice(1) : fallback.slice(1)
  return rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
}

function centered(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>, maxWidth = 740) {
  const drawSize = Math.min(size, maxWidth / Math.max(font.widthOfTextAtSize(text, size), 1) * size)
  const width = font.widthOfTextAtSize(text, drawSize)
  page.drawText(text, { x: Math.max(48, (PAGE_W - width) / 2), y, size: drawSize, font, color })
}

function icon(page: PDFPage, platform: string, x: number, y: number, font: PDFFont, foreground: ReturnType<typeof rgb>) {
  const bg = socialColor[platform] || foreground
  page.drawCircle({ x: x + 7, y: y + 7, size: 7, color: bg })
  if (platform === 'facebook') page.drawText('f', { x: x + 5, y: y + 2, size: 10, font, color: rgb(1, 1, 1) })
  else if (platform === 'instagram') {
    page.drawRectangle({ x: x + 3, y: y + 3, width: 8, height: 8, borderColor: rgb(1, 1, 1), borderWidth: 0.8 })
    page.drawCircle({ x: x + 7, y: y + 7, size: 2, borderColor: rgb(1, 1, 1), borderWidth: 0.8 })
    page.drawCircle({ x: x + 10, y: y + 10, size: 0.6, color: rgb(1, 1, 1) })
  } else if (platform === 'youtube') {
    page.drawRectangle({ x: x + 2.5, y: y + 4, width: 9, height: 6, color: rgb(1, 1, 1) })
    page.drawSvgPath('M 0 0 L 0 5 L 4 2.5 Z', { x: x + 5.5, y: y + 4.5, color: bg })
  } else if (platform === 'tiktok') {
    page.drawLine({ start: { x: x + 7, y: y + 4 }, end: { x: x + 7, y: y + 11 }, thickness: 1.5, color: rgb(1, 1, 1) })
    page.drawLine({ start: { x: x + 7, y: y + 10 }, end: { x: x + 10, y: y + 9 }, thickness: 1.5, color: rgb(1, 1, 1) })
    page.drawCircle({ x: x + 5.5, y: y + 4.5, size: 1.7, color: rgb(1, 1, 1) })
  } else if (platform === 'x') {
    page.drawLine({ start: { x: x + 4, y: y + 4 }, end: { x: x + 10, y: y + 10 }, thickness: 1.3, color: rgb(1, 1, 1) })
    page.drawLine({ start: { x: x + 4, y: y + 10 }, end: { x: x + 10, y: y + 4 }, thickness: 1.3, color: rgb(1, 1, 1) })
  } else if (platform === 'linkedin') page.drawText('in', { x: x + 3, y: y + 4, size: 6, font, color: rgb(1, 1, 1) })
  else if (platform === 'whatsapp') {
    page.drawCircle({ x: x + 7, y: y + 7, size: 4.4, borderColor: rgb(1, 1, 1), borderWidth: 0.9 })
    page.drawLine({ start: { x: x + 4, y: y + 4 }, end: { x: x + 2.8, y: y + 2.5 }, thickness: 0.9, color: rgb(1, 1, 1) })
    page.drawLine({ start: { x: x + 5, y: y + 8 }, end: { x: x + 8, y: y + 6 }, thickness: 1, color: rgb(1, 1, 1) })
  }
}

function addPdfLink(pdf: PDFDocument, page: PDFPage, url: string, x: number, y: number, size: number) {
  try {
    const uri = new URL(url)
    if (uri.protocol !== 'https:') return
    const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, y, x + size, y + size], Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of(uri.toString()) } })
    page.node.addAnnot(pdf.context.register(annotation))
  } catch { /* Ignore unconfigured or invalid social URLs. */ }
}

function contactIcon(page: PDFPage, kind: 'address' | 'phone' | 'website', x: number, y: number, color: ReturnType<typeof rgb>) {
  if (kind === 'address') {
    page.drawCircle({ x: x + 4, y: y + 5, size: 3.6, borderColor: color, borderWidth: 0.85 })
    page.drawCircle({ x: x + 4, y: y + 5, size: 1.1, color })
    page.drawLine({ start: { x: x + 1.1, y: y + 2.7 }, end: { x: x + 4, y: y - 0.7 }, thickness: 0.8, color })
    page.drawLine({ start: { x: x + 6.9, y: y + 2.7 }, end: { x: x + 4, y: y - 0.7 }, thickness: 0.8, color })
  } else if (kind === 'phone') {
    page.drawLine({ start: { x: x + 1, y: y + 8 }, end: { x: x + 2.7, y: y + 6.2 }, thickness: 1.7, color })
    page.drawLine({ start: { x: x + 2.7, y: y + 6.2 }, end: { x: x + 5.5, y: y + 3.4 }, thickness: 1.7, color })
    page.drawLine({ start: { x: x + 5.5, y: y + 3.4 }, end: { x: x + 7.5, y: y + 5.3 }, thickness: 1.7, color })
    page.drawLine({ start: { x: x + 1, y: y + 8 }, end: { x: x + 2.4, y: y + 9 }, thickness: 1, color })
    page.drawLine({ start: { x: x + 6.2, y: y + 2.7 }, end: { x: x + 7.5, y: y + 5.3 }, thickness: 1, color })
  } else {
    page.drawCircle({ x: x + 4, y: y + 5, size: 4, borderColor: color, borderWidth: 0.8 })
    page.drawLine({ start: { x: x, y: y + 5 }, end: { x: x + 8, y: y + 5 }, thickness: 0.55, color })
    page.drawLine({ start: { x: x + 4, y: y + 1 }, end: { x: x + 4, y: y + 9 }, thickness: 0.55, color })
    page.drawLine({ start: { x: x + 1, y: y + 7.5 }, end: { x: x + 7, y: y + 7.5 }, thickness: 0.45, color })
    page.drawLine({ start: { x: x + 1, y: y + 2.5 }, end: { x: x + 7, y: y + 2.5 }, thickness: 0.45, color })
  }
}

export async function buildCertificatePdf(cert: CertificateData, branding: CertificateBranding, baseUrl: string, logoBytes?: Uint8Array, preview = false) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([PAGE_W, PAGE_H])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const gold = rgb(0.78, 0.61, 0.02), dark = rgb(0.07, 0.09, 0.12), muted = rgb(0.32, 0.35, 0.4), cream = rgb(0.99, 0.98, 0.94)

  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: cream })
  // Repeat the vector-text watermark on the full sheet before drawing any foreground content.
  if (branding.watermarkEnabled) {
    const wm = hexColor(branding.watermarkColor)
    const opacity = Math.min(0.14, Math.max(0.025, Number(branding.watermarkOpacity) || 0.085))
    const size = Math.min(12, Math.max(5, Number(branding.watermarkFontSize) || 7))
    const spacing = Math.min(100, Math.max(34, Number(branding.watermarkSpacing) || 64))
    const angle = Math.min(-12, Math.max(-55, Number(branding.watermarkAngle) || -28))
    const text = (branding.watermarkText || 'AMINCI RADIO 103.9 FM KANO · OFFICIAL CERTIFICATE').slice(0, 100)
    const xStep = Math.max(150, spacing * 3.7)
    for (let y = -PAGE_H; y < PAGE_H * 1.5; y += spacing) {
      for (let x = -PAGE_W; x < PAGE_W * 1.5; x += xStep) {
        page.drawText(text, { x: x + ((Math.round(y / spacing) % 2) * xStep) / 2, y, size, font: regular, color: wm, opacity, rotate: degrees(angle) })
      }
    }
  }
  if (branding.securityBorderEnabled) {
    page.drawRectangle({ x: 17, y: 17, width: PAGE_W - 34, height: PAGE_H - 34, borderColor: gold, borderWidth: 1.8 })
    page.drawRectangle({ x: 24, y: 24, width: PAGE_W - 48, height: PAGE_H - 48, borderColor: rgb(0.83, 0.78, 0.59), borderWidth: 0.6 })
    page.drawRectangle({ x: 30, y: 30, width: 8, height: PAGE_H - 60, color: gold })
    for (const [x, y, sx, sy] of [[43, 43, 1, 1], [PAGE_W - 43, 43, -1, 1], [43, PAGE_H - 43, 1, -1], [PAGE_W - 43, PAGE_H - 43, -1, -1]]) {
      page.drawLine({ start: { x, y }, end: { x: x + sx * 26, y }, thickness: 0.8, color: gold })
      page.drawLine({ start: { x, y }, end: { x, y: y + sy * 26 }, thickness: 0.8, color: gold })
      page.drawLine({ start: { x: x + sx * 5, y: y + sy * 5 }, end: { x: x + sx * 18, y: y + sy * 18 }, thickness: 0.55, color: gold, opacity: 0.7 })
    }
  }

  // Letterhead: fit the supplied logo within a square while preserving its aspect ratio.
  if (logoBytes?.byteLength) {
    try {
      const isPng = logoBytes[0] === 0x89 && logoBytes[1] === 0x50
      const image = isPng ? await pdf.embedPng(logoBytes) : await pdf.embedJpg(logoBytes)
      const box = { x: 48, y: 484, width: 72, height: 72 }
      const scale = Math.min(box.width / image.width, box.height / image.height)
      const width = image.width * scale, height = image.height * scale
      page.drawImage(image, { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height })
    } catch { /* Retain the letterhead text if a custom logo cannot be embedded. */ }
  }
  page.drawText((branding.stationName || 'AMINCI RADIO 103.9 FM KANO').slice(0, 64), { x: 126, y: 535, size: 14, font: bold, color: dark, maxWidth: 330 })
  contactIcon(page, 'address', 126, 516, gold)
  contactIcon(page, 'phone', 126, 501, gold)
  contactIcon(page, 'website', 126, 486, gold)
  page.drawText(`Address: ${(branding.stationAddress || '').slice(0, 80)}`, { x: 139, y: 518, size: 8, font: regular, color: muted, maxWidth: 322 })
  page.drawText(`Phone: ${(branding.stationPhone || '').slice(0, 32)}`, { x: 139, y: 503, size: 8, font: regular, color: muted, maxWidth: 322 })
  page.drawText(`Website: ${(branding.stationWebsite || '').slice(0, 64)}`, { x: 139, y: 488, size: 8, font: regular, color: muted, maxWidth: 322 })
  page.drawLine({ start: { x: 475, y: 481 }, end: { x: 475, y: 550 }, thickness: 1, color: gold })
  page.drawText('IN COLLABORATION WITH', { x: 500, y: 536, size: 8, font: bold, color: muted })
  page.drawText('DUNIYAR SOCIAL MEDIA', { x: 500, y: 517, size: 13, font: bold, color: rgb(0.03, 0.31, 0.55) })
  let iconX = 500
  for (const { platform, url } of configuredSocialAccounts(branding.socialLinks || {})) {
    icon(page, platform, iconX, 487, bold, muted)
    addPdfLink(pdf, page, url, iconX, 487, 14)
    iconX += 23
  }

  centered(page, 'CERTIFICATE', 429, 40, bold, dark)
  page.drawRectangle({ x: 279, y: 390, width: 284, height: 24, color: gold })
  centered(page, 'OF PARTICIPATION', 396, 14, bold, dark, 280)
  centered(page, 'This certificate is proudly presented to', 353, 14, italic, muted)
  const availableNameWidth = 720
  const nameSize = Math.min(28, Math.max(15, availableNameWidth / Math.max(bold.widthOfTextAtSize(cert.name, 28), 1) * 28))
  centered(page, cert.name, 309, nameSize, bold, dark, availableNameWidth)
  page.drawLine({ start: { x: 70, y: 294 }, end: { x: PAGE_W - 70, y: 294 }, thickness: 1.25, color: gold })
  centered(page, 'In recognition of successful participation in the training programme on:', 266, 11, italic, muted)
  centered(page, 'Social Media, Cybersecurity, and Artificial Intelligence', 240, 15, bold, dark, 700)
  page.drawText(`Date: ${cert.eventDate || ''}`, { x: 78, y: 198, size: 11, font: bold, color: dark, maxWidth: 550 })
  page.drawText(`Venue: ${cert.venue || ''}`, { x: 78, y: 180, size: 8, font: regular, color: muted, maxWidth: 590 })
  centered(page, 'Organisers: Aminci Radio 103.9 FM Kano · Duniyar Social Media', 158, 9, bold, dark, 650)

  // White-cream signature/stamp panels keep the watermark clear of signing areas.
  page.drawRectangle({ x: 55, y: 66, width: 455, height: 69, color: cream, opacity: 0.96 })
  page.drawLine({ start: { x: 67, y: 112 }, end: { x: 246, y: 112 }, thickness: 0.8, color: dark })
  page.drawText('Programme Coordinator', { x: 93, y: 95, size: 9, font: bold, color: dark })
  page.drawLine({ start: { x: 286, y: 112 }, end: { x: 466, y: 112 }, thickness: 0.8, color: dark })
  page.drawText('Aminci Radio Representative', { x: 300, y: 95, size: 9, font: bold, color: dark })
  page.drawCircle({ x: 584, y: 102, size: 35, borderColor: gold, borderWidth: 1.2 })
  page.drawCircle({ x: 584, y: 102, size: 29, borderColor: gold, borderWidth: 0.55 })
  page.drawText('OFFICIAL', { x: 563, y: 104, size: 8, font: bold, color: muted })
  page.drawText('STAMP AREA', { x: 558, y: 92, size: 7, font: regular, color: muted })
  page.drawRectangle({ x: 720, y: 74, width: 80, height: 80, color: cream, borderColor: gold, borderWidth: 1.1 })
  const qrContents = certificateQrTarget(cert, baseUrl, preview)
  const qrUrl = await QRCode.toDataURL(qrContents, { width: 256, margin: 1, errorCorrectionLevel: 'H' })
  const qrImage = await pdf.embedPng(new Uint8Array(await (await fetch(qrUrl)).arrayBuffer()))
  page.drawImage(qrImage, { x: 726, y: 80, width: 68, height: 68 })
  centered(page, 'SCAN TO VERIFY', 62, 6.5, bold, muted, 80)
  page.drawText(`Registration ID ${cert.registrationId}`, { x: 54, y: 42, size: 7.5, font: regular, color: muted })
  page.drawText(`Certificate No. ${cert.certificateNumber}`, { x: 500, y: 42, size: 7.5, font: bold, color: dark, maxWidth: 250 })
  if (preview) page.drawText('ADMIN PREVIEW · NOT VALID', { x: 500, y: 28, size: 7, font: bold, color: rgb(0.68, 0.15, 0.1) })
  else page.drawText('Present this certificate for verification.', { x: 500, y: 28, size: 7, font: regular, color: muted })
  return pdf.save()
}
