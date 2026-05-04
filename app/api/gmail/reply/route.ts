import { createClient } from '@/lib/supabase/server'
import { getGmailClient, EMAIL_SIGNATURE, isInvalidGrant } from '@/lib/gmail'
import { NextRequest, NextResponse } from 'next/server'

function buildReplyMime(
  to: string, from: string, subject: string, body: string, inReplyTo?: string | null
): string {
  const reSubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`
  const lines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${reSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
  ]
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`)
    lines.push(`References: ${inReplyTo}`)
  }
  lines.push('', body.replace(/\n/g, '<br>') + EMAIL_SIGNATURE)
  return Buffer.from(lines.join('\r\n')).toString('base64url')
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { inboxMessageId, body } = await req.json() as {
    inboxMessageId: string
    body: string
  }

  if (!inboxMessageId || !body?.trim()) {
    return NextResponse.json({ error: 'inboxMessageId and body are required' }, { status: 400 })
  }

  // Load the inbox message we're replying to
  const { data: msg } = await supabase
    .from('inbox_messages')
    .select('from_email, from_name, subject, gmail_thread_id, gmail_rfc_message_id, contact_id')
    .eq('id', inboxMessageId)
    .eq('user_id', user.id)
    .single()

  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

  try {
    const gmail = await getGmailClient(user.id)

    // Get the sender's Gmail address
    const profile = await gmail.users.getProfile({ userId: 'me' })
    const fromEmail = profile.data.emailAddress!

    const raw = buildReplyMime(
      msg.from_email,
      fromEmail,
      msg.subject ?? '',
      body.trim(),
      msg.gmail_rfc_message_id,
    )

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId: msg.gmail_thread_id },
    })

    // Log to email_history
    await supabase.from('email_history').insert({
      user_id: user.id,
      contact_id: msg.contact_id ?? null,
      to_email: msg.from_email,
      to_name: msg.from_name ?? null,
      subject: msg.subject?.toLowerCase().startsWith('re:') ? msg.subject : `Re: ${msg.subject ?? ''}`,
      body: body.trim(),
      status: 'sent',
      sent_at: new Date().toISOString(),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isInvalidGrant(err)) {
      return NextResponse.json({ error: 'gmail_reconnect_required' }, { status: 401 })
    }
    const message = err instanceof Error ? err.message : 'Send failed'
    console.error('[gmail/reply] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
