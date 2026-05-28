import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Resend posts to this endpoint; verify with a shared secret in the URL.
// In the Resend dashboard set webhook URL to:
//   https://laundry-email-system.vercel.app/api/webhooks/resend?secret=<RESEND_WEBHOOK_SECRET>

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.RESEND_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await req.json()
  const { type, data } = payload as {
    type: string
    data: {
      email_id: string
      to: string[]
      bounce?: { type: 'hard' | 'soft' }
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  if (type === 'email.bounced' && data.bounce?.type === 'hard') {
    const { data: record } = await supabase
      .from('email_history')
      .select('id')
      .eq('resend_email_id', data.email_id)
      .single()

    if (record) {
      await supabase
        .from('email_history')
        .update({ status: 'failed', error_message: 'Hard bounce' })
        .eq('id', record.id)
    }
  }

  if (type === 'email.complained') {
    const toEmail = data.to?.[0]

    // Find contact_id via resend_email_id first, then fall back to email address
    let contactId: string | null = null

    const { data: record } = await supabase
      .from('email_history')
      .select('contact_id')
      .eq('resend_email_id', data.email_id)
      .single()

    contactId = record?.contact_id ?? null

    if (!contactId && toEmail) {
      const { data: fallback } = await supabase
        .from('email_history')
        .select('contact_id')
        .eq('to_email', toEmail)
        .eq('status', 'sent')
        .not('contact_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      contactId = fallback?.contact_id ?? null
    }

    if (contactId) {
      await supabase
        .from('contacts')
        .update({ do_not_contact: true })
        .eq('id', contactId)
    }
  }

  return NextResponse.json({ ok: true })
}
