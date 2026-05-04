import { createClient } from '@/lib/supabase/server'
import { sendGmailMessage, isInvalidGrant } from '@/lib/gmail'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  console.log('[emails/send] ── START ──────────────────────────────────────')

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  console.log('[emails/send] user id:', user?.id ?? null, '| auth error:', authError?.message ?? null)

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { contactId, templateId, toEmail, toName, subject, body, scheduleAt } = await request.json()
  console.log('[emails/send] to:', toEmail, '| contactId:', contactId, '| scheduleAt:', scheduleAt ?? null)

  if (!toEmail || !subject || !body) {
    return NextResponse.json({ error: 'toEmail, subject and body are required' }, { status: 400 })
  }

  // Check DNC
  if (contactId) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('do_not_contact')
      .eq('id', contactId)
      .single()

    if (contact?.do_not_contact) {
      console.log('[emails/send] blocked — contact is DNC')
      return NextResponse.json({ error: 'This contact is on the Do Not Contact list' }, { status: 403 })
    }
  }

  // If scheduling, insert record and return
  if (scheduleAt) {
    const scheduledDate = new Date(scheduleAt)
    if (scheduledDate <= new Date()) {
      return NextResponse.json({ error: 'Scheduled time must be in the future' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('email_history')
      .insert({
        user_id: user.id,
        contact_id: contactId ?? null,
        template_id: templateId ?? null,
        to_email: toEmail,
        to_name: toName ?? null,
        subject,
        body,
        status: 'scheduled',
        scheduled_at: scheduledDate.toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('[emails/send] schedule insert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    console.log('[emails/send] scheduled successfully, id:', data?.id)
    return NextResponse.json({ scheduled: true, email: data }, { status: 201 })
  }

  // Send immediately via Gmail
  try {
    console.log('[emails/send] calling sendGmailMessage for user:', user.id)
    await sendGmailMessage(user.id, toEmail, subject, body)
    console.log('[emails/send] sendGmailMessage succeeded')

    const { data, error: insertError } = await supabase
      .from('email_history')
      .insert({
        user_id: user.id,
        contact_id: contactId ?? null,
        template_id: templateId ?? null,
        to_email: toEmail,
        to_name: toName ?? null,
        subject,
        body,
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) console.error('[emails/send] history insert error (non-fatal):', insertError)
    console.log('[emails/send] ── SUCCESS ──')
    return NextResponse.json({ sent: true, email: data }, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send email'
    console.error('[emails/send] ── SEND ERROR:', message)
    if (err && typeof err === 'object' && 'response' in err) {
      console.error('[emails/send] API response:', JSON.stringify((err as { response: unknown }).response, null, 2))
    }

    if (isInvalidGrant(err)) {
      // Clear stale tokens so Settings page shows "Not connected"
      await supabase.from('profiles').update({
        gmail_access_token: null,
        gmail_refresh_token: null,
        gmail_token_expiry: null,
      }).eq('id', user.id)
      return NextResponse.json({ error: 'gmail_reconnect_required' }, { status: 401 })
    }

    await supabase.from('email_history').insert({
      user_id: user.id,
      contact_id: contactId ?? null,
      template_id: templateId ?? null,
      to_email: toEmail,
      to_name: toName ?? null,
      subject,
      body,
      status: 'failed',
      error_message: message,
    })

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
