import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/resend'
import { replacePlaceholders } from '@/lib/gmail'
import { NextRequest, NextResponse } from 'next/server'

// Hard cap to stay well within Vercel's 10s function timeout.
// At ~150ms per Resend API call, 15 emails ≈ 2-4s — leaves plenty of headroom.
const MAX_BATCH = 15

function batchSize(rateDelayMs: number): number {
  return Math.min(MAX_BATCH, Math.max(1, Math.floor(60_000 / rateDelayMs)))
}

export async function POST(req: NextRequest) {
  // Verify cron secret
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1. Activate scheduled jobs whose time has come
  const now = new Date().toISOString()
  await supabase
    .from('bulk_send_jobs')
    .update({ status: 'running', started_at: now })
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)

  // 2. Process running jobs
  const { data: runningJobs } = await supabase
    .from('bulk_send_jobs')
    .select('*')
    .eq('status', 'running')

  if (!runningJobs?.length) {
    return NextResponse.json({ processed: 0 })
  }

  let totalSent = 0

  for (const job of runningJobs) {
    const batch = batchSize(job.rate_delay_ms)
    const start = job.current_offset
    const end = Math.min(start + batch, job.total_count)
    const contactIds: string[] = (job.contact_ids as string[]).slice(start, end)

    if (contactIds.length === 0) {
      await supabase
        .from('bulk_send_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', job.id)
      continue
    }

    const { data: contacts } = await supabase
      .from('contacts')
      .select('id,name,email,company,address,phone,do_not_contact,status')
      .in('id', contactIds)

    let sent = job.sent_count
    let failed = job.failed_count
    let offset = start

    for (const contact of (contacts ?? [])) {
      if (contact.do_not_contact || contact.status === 'confirmed') {
        offset++
        continue
      }

      const data = {
        name: contact.name ?? '',
        email: contact.email ?? '',
        company: contact.company ?? '',
        address: contact.address ?? '',
        phone: contact.phone ?? '',
      }

      try {
        const resendEmailId = await sendEmail(
          contact.email,
          replacePlaceholders(job.subject, data),
          replacePlaceholders(job.body, data)
        )
        await supabase.from('email_history').insert({
          user_id: job.user_id,
          contact_id: contact.id,
          template_id: job.template_id ?? null,
          to_email: contact.email,
          to_name: contact.name ?? null,
          subject: replacePlaceholders(job.subject, data),
          body: replacePlaceholders(job.body, data),
          status: 'sent',
          sent_at: new Date().toISOString(),
          resend_email_id: resendEmailId,
        })
        sent++
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Send failed'
        await supabase.from('email_history').insert({
          user_id: job.user_id,
          contact_id: contact.id,
          template_id: job.template_id ?? null,
          to_email: contact.email,
          to_name: contact.name ?? null,
          subject: replacePlaceholders(job.subject, data),
          body: replacePlaceholders(job.body, data),
          status: 'failed',
          error_message: msg,
        })
        failed++
      }
      offset++
      totalSent++
    }

    const newOffset = offset
    const isComplete = newOffset >= job.total_count

    await supabase.from('bulk_send_jobs').update({
      sent_count: sent,
      failed_count: failed,
      current_offset: newOffset,
      ...(isComplete ? { status: 'completed', completed_at: new Date().toISOString() } : {}),
    }).eq('id', job.id)
  }

  return NextResponse.json({ processed: totalSent })
}
