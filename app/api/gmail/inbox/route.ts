import { createClient } from '@/lib/supabase/server'
import { getGmailClient } from '@/lib/gmail'
import { NextResponse } from 'next/server'
import type { gmail_v1 } from 'googleapis'

// ── MIME helpers ──────────────────────────────────────────────────────────────

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function parseFrom(from: string): { name: string | null; email: string } {
  const m = from.match(/^"?([^"<]*)"?\s*<([^>]+)>$/)
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() }
  return { name: null, email: from.trim().toLowerCase() }
}

function decodeBody(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8')
}

function extractText(part: gmail_v1.Schema$MessagePart): string {
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeBody(part.body.data)
  if (part.mimeType === 'text/html' && part.body?.data && !part.parts) {
    return decodeBody(part.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  if (part.parts) {
    for (const p of part.parts) {
      const t = extractText(p)
      if (t) return t
    }
  }
  return ''
}

// ── Sync ──────────────────────────────────────────────────────────────────────

async function syncInbox(userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { createClient: createServiceClient } = await import('@supabase/supabase-js')
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const gmail = await getGmailClient(userId)

  // Get existing synced IDs to avoid re-fetching
  const { data: existing } = await admin
    .from('inbox_messages')
    .select('gmail_message_id')
    .eq('user_id', userId)
  const existingIds = new Set((existing ?? []).map((r: { gmail_message_id: string }) => r.gmail_message_id))

  // Load all contact emails for matching
  const { data: contacts } = await admin
    .from('contacts')
    .select('id, email, name')
    .eq('user_id', userId)
  const contactMap = new Map<string, { id: string; name: string }>()
  for (const c of (contacts ?? [])) {
    contactMap.set((c.email as string).toLowerCase(), { id: c.id as string, name: c.name as string })
  }

  // List recent inbox messages (metadata only — fast)
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'in:inbox newer_than:60d',
    maxResults: 50,
  })
  const msgRefs = listRes.data.messages ?? []

  const toInsert: Record<string, unknown>[] = []

  for (const { id: msgId } of msgRefs) {
    if (!msgId || existingIds.has(msgId)) continue

    try {
      // Fetch metadata headers first (cheap)
      const meta = await gmail.users.messages.get({
        userId: 'me', id: msgId,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date', 'Message-ID'],
      })
      const headers = meta.data.payload?.headers ?? []
      const fromRaw = getHeader(headers, 'From')
      const { email: fromEmail, name: fromName } = parseFrom(fromRaw)
      const contact = contactMap.get(fromEmail)
      if (!contact) continue // skip non-contact senders

      // Fetch full body only for matching contacts
      const full = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' })
      const fullHeaders = full.data.payload?.headers ?? []
      const bodyText = extractText(full.data.payload ?? {})
      const rfcMsgId = getHeader(fullHeaders, 'Message-ID')
      const dateRaw = getHeader(fullHeaders, 'Date')
      const subject = getHeader(fullHeaders, 'Subject') || '(no subject)'

      toInsert.push({
        user_id: userId,
        contact_id: contact.id,
        gmail_message_id: msgId,
        gmail_thread_id: full.data.threadId!,
        gmail_rfc_message_id: rfcMsgId || null,
        from_email: fromEmail,
        from_name: fromName ?? contact.name,
        subject,
        body_preview: bodyText.slice(0, 300).replace(/\s+/g, ' ').trim(),
        body_full: bodyText.slice(0, 20000),
        received_at: dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString(),
        is_read: false,
      })
    } catch (e) {
      console.error('[inbox/sync] failed to process message', msgId, e)
    }
  }

  if (toInsert.length > 0) {
    const { error } = await admin.from('inbox_messages').insert(toInsert)
    if (error) console.error('[inbox/sync] insert error:', error.message)
    else console.log('[inbox/sync] inserted', toInsert.length, 'new messages')
  }

  return toInsert.length
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Sync in background — don't block the response on errors
  let newCount = 0
  try {
    newCount = await syncInbox(user.id)
  } catch (e) {
    console.error('[inbox] sync error (non-fatal):', e instanceof Error ? e.message : e)
  }

  const { data: messages, error } = await supabase
    .from('inbox_messages')
    .select('*, contacts(name, email, status)')
    .eq('user_id', user.id)
    .order('received_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ messages: messages ?? [], newCount })
}
