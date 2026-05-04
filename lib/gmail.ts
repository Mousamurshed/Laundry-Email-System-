import { google } from 'googleapis'
import { createClient } from '@/lib/supabase/server'

// Hardcoded to avoid any trailing-slash or env-var mismatch with Google's registered URI.
// Must exactly match what is listed in Google Cloud Console → Authorized redirect URIs.
const GMAIL_REDIRECT_URI = 'https://laundry-email-system.vercel.app/api/gmail/callback'

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    GMAIL_REDIRECT_URI
  )
}

export function getAuthUrl(state: string) {
  const oauth2Client = getOAuthClient()
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    state,
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  })
}

export function isInvalidGrant(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  // Check message string
  const msg = (err as { message?: string }).message?.toLowerCase() ?? ''
  if (msg.includes('invalid_grant') || msg.includes('token has been expired or revoked')) return true
  // Google API errors wrap the reason in response.data.error
  const data = (err as { response?: { data?: { error?: string } } }).response?.data?.error
  if (typeof data === 'string' && data.toLowerCase().includes('invalid_grant')) return true
  return false
}

export function sanitizeEmail(email: string): string {
  return email.trim().replace(/^[<(](.+)[>)]$/, '$1').trim()
}

export async function getGmailClient(userId: string) {
  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('gmail_access_token, gmail_refresh_token, gmail_token_expiry')
    .eq('id', userId)
    .single()

  if (!profile?.gmail_access_token || !profile?.gmail_refresh_token) {
    throw new Error('Gmail not connected')
  }

  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials({
    access_token: profile.gmail_access_token,
    refresh_token: profile.gmail_refresh_token,
    expiry_date: profile.gmail_token_expiry
      ? new Date(profile.gmail_token_expiry).getTime()
      : undefined,
  })

  // Auto-refresh handler: persist new tokens
  oauth2Client.on('tokens', async (tokens) => {
    const updates: Record<string, string> = {}
    if (tokens.access_token) updates.gmail_access_token = tokens.access_token
    if (tokens.expiry_date)
      updates.gmail_token_expiry = new Date(tokens.expiry_date).toISOString()
    if (Object.keys(updates).length > 0) {
      await supabase.from('profiles').update(updates).eq('id', userId)
    }
  })

  return google.gmail({ version: 'v1', auth: oauth2Client })
}

function extractFirstNames(fullName: string): string {
  const parts = fullName
    .split(/\s*&\s*|\s*,\s*|\s+and\s+/i)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.split(/\s+/)[0])
    .filter(Boolean)
  if (parts.length === 0) return fullName
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} & ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`
}

export function replacePlaceholders(
  text: string,
  data: Record<string, string | null>
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = data[key] ?? ''
    if (key === 'name') return extractFirstNames(value)
    return value
  })
}

export const EMAIL_SIGNATURE = `<br><br><hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0;">
<p style="font-family:Arial,sans-serif;font-size:16px;font-weight:bold;font-style:italic;color:#3a7d3a;margin:0 0 4px;">The Laundry Day Team</p>
<p style="font-family:Arial,sans-serif;font-size:13px;color:#333;margin:2px 0;">(646) 705-0600 - <a href="mailto:laundrydaynyc@gmail.com" style="color:#1155CC;">laundrydaynyc@gmail.com</a></p>
<p style="font-family:Arial,sans-serif;font-size:13px;margin:2px 0;"><a href="https://laundryday.nyc/" style="color:#1155CC;">Our Website</a></p>
<p style="font-family:Arial,sans-serif;font-size:13px;margin:2px 0;"><a href="https://laundryday.nyc/assets/partnerassets/documents/Terms%20Of%20Service.pdf" style="color:#1155CC;">Terms &amp; Services</a></p>`

export function buildMimeMessage(
  to: string,
  from: string,
  subject: string,
  body: string
): string {
  const message = [
    `To: ${sanitizeEmail(to)}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    body.replace(/\n/g, '<br>') + EMAIL_SIGNATURE,
  ].join('\r\n')

  return Buffer.from(message).toString('base64url')
}

export async function sendGmailMessage(
  userId: string,
  to: string,
  subject: string,
  body: string
) {
  const gmail = await getGmailClient(userId)

  const profile = await gmail.users.getProfile({ userId: 'me' })
  const fromEmail = profile.data.emailAddress!

  const raw = buildMimeMessage(sanitizeEmail(to), fromEmail, subject, body)

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  })

  return res.data
}
