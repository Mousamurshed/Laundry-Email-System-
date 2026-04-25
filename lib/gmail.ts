import { google } from 'googleapis'
import { createClient } from '@/lib/supabase/server'

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_URL}/api/gmail/callback`
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

export function replacePlaceholders(
  text: string,
  data: Record<string, string | null>
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? '')
}

export function buildMimeMessage(
  to: string,
  from: string,
  subject: string,
  body: string
): string {
  const message = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    body.replace(/\n/g, '<br>'),
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

  const raw = buildMimeMessage(to, fromEmail, subject, body)

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  })

  return res.data
}
