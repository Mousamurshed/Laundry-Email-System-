import { createClient } from '@/lib/supabase/server'
import { sendGmailMessage } from '@/lib/gmail'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { contactId, templateId, toEmail, toName, subject, body, scheduleAt } = await request.json()

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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ scheduled: true, email: data }, { status: 201 })
  }

  // Send immediately via Gmail
  try {
    await sendGmailMessage(user.id, toEmail, subject, body)

    const { data } = await supabase
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

    return NextResponse.json({ sent: true, email: data }, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send email'

    // Log failed attempt
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
