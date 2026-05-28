import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/resend'
import { NextRequest, NextResponse } from 'next/server'

// Called by Vercel Cron — protected by CRON_SECRET
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Age 'new' contacts older than 48 h to 'uncontacted' (all users, needs service role).
  const adminSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  await adminSupabase
    .from('contacts')
    .update({ status: 'uncontacted' })
    .eq('status', 'new')
    .lt('created_at', cutoff)

  const supabase = await createClient()

  // Find all scheduled emails that are due
  const { data: due, error } = await supabase
    .from('email_history')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due?.length) return NextResponse.json({ processed: 0 })

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

  return NextResponse.json({ processed: due.length, succeeded, failed })
}
