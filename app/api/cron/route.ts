import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/resend'
import { getOAuthClient } from '@/lib/gmail'
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = ReturnType<typeof createServiceClient<any>>

async function detectRepliesForUser(userId: string, admin: AdminClient): Promise<number> {
  const { data: profileRow } = await admin
    .from('profiles')
    .select('gmail_access_token, gmail_refresh_token, gmail_token_expiry')
    .eq('id', userId)
    .single()

  const profile = profileRow as {
    gmail_access_token: string | null
    gmail_refresh_token: string | null
    gmail_token_expiry: string | null
  } | null

  if (!profile?.gmail_access_token || !profile?.gmail_refresh_token) return 0

  const oauth2 = getOAuthClient()
  oauth2.setCredentials({
    access_token: profile.gmail_access_token,
    refresh_token: profile.gmail_refresh_token,
    expiry_date: profile.gmail_token_expiry
      ? new Date(profile.gmail_token_expiry).getTime()
      : undefined,
  })
  oauth2.on('tokens', async (tokens) => {
    const u: Record<string, string> = {}
    if (tokens.access_token) u.gmail_access_token = tokens.access_token
    if (tokens.expiry_date) u.gmail_token_expiry = new Date(tokens.expiry_date).toISOString()
    if (Object.keys(u).length > 0) await admin.from('profiles').update(u).eq('id', userId)
  })
  const gmail = google.gmail({ version: 'v1', auth: oauth2 })

  const since14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data: sentRows } = await admin
    .from('email_history')
    .select('contact_id, to_email')
    .eq('user_id', userId)
    .eq('status', 'sent')
    .not('contact_id', 'is', null)
    .gte('sent_at', since14d)

  const sentEmails = (sentRows ?? []) as { contact_id: string; to_email: string }[]
  if (!sentEmails.length) return 0

  const emailToContact: Record<string, string> = {}
  for (const e of sentEmails) {
    if (e.to_email && e.contact_id) emailToContact[e.to_email.toLowerCase()] = e.contact_id
  }
  const uniqueEmails = [...new Set(sentEmails.map(e => e.to_email?.toLowerCase()).filter(Boolean))]

  const updated = new Set<string>()
  const now = new Date().toISOString()

  // Check in batches of 10 — cap at 30 per cron tick to stay within 10s
  for (let i = 0; i < Math.min(uniqueEmails.length, 30); i += 10) {
    const batch = uniqueEmails.slice(i, i + 10)
    const query = batch.map(e => `from:${e}`).join(' OR ')
    try {
      const { data } = await gmail.users.messages.list({
        userId: 'me',
        q: `(${query}) in:inbox`,
        maxResults: 50,
      })
      for (const msg of data.messages ?? []) {
        const { data: full } = await gmail.users.messages.get({
          userId: 'me', id: msg.id!, format: 'metadata', metadataHeaders: ['From'],
        })
        const fromHeader = full.payload?.headers?.find(h => h.name === 'From')?.value ?? ''
        const match = fromHeader.match(/<(.+?)>/) ?? fromHeader.match(/(\S+@\S+)/)
        const fromEmail = (match?.[1] ?? fromHeader).toLowerCase().trim()
        const contactId = emailToContact[fromEmail]
        if (contactId && !updated.has(contactId)) {
          await admin
            .from('contacts')
            .update({ status: 'responded', responded_at: now })
            .eq('id', contactId)
            .neq('status', 'responded')
          updated.add(contactId)
        }
      }
    } catch { continue }
  }

  return updated.size
}

// Called by Vercel Cron — protected by CRON_SECRET
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as AdminClient

  // Age 'new' contacts older than 48h to 'uncontacted'
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  await adminSupabase
    .from('contacts')
    .update({ status: 'uncontacted' })
    .eq('status', 'new')
    .lt('created_at', cutoff)

  // Detect Gmail replies for all users with Gmail connected
  let repliesDetected = 0
  const { data: gmailProfileRows } = await adminSupabase
    .from('profiles')
    .select('id')
    .not('gmail_refresh_token', 'is', null)

  const gmailProfiles = (gmailProfileRows ?? []) as { id: string }[]
  for (const p of gmailProfiles) {
    try {
      repliesDetected += await detectRepliesForUser(p.id, adminSupabase)
    } catch { /* non-fatal — continue to next user */ }
  }

  const supabase = await createClient()

  // Find all scheduled emails that are due
  const { data: due, error } = await supabase
    .from('email_history')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due?.length) return NextResponse.json({ processed: 0, repliesDetected })

  let succeeded = 0
  let failed = 0

  for (const email of due) {
    try {
      const resendEmailId = await sendEmail(email.to_email, email.subject, email.body)

      await supabase
        .from('email_history')
        .update({ status: 'sent', sent_at: new Date().toISOString(), resend_email_id: resendEmailId })
        .eq('id', email.id)

      succeeded++
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Send failed'
      await supabase
        .from('email_history')
        .update({ status: 'failed', error_message: message })
        .eq('id', email.id)
      failed++
    }
  }

  return NextResponse.json({ processed: due.length, succeeded, failed, repliesDetected })
}
