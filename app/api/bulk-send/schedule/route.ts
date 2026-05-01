import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { templateId, subject, body, contactIds, filterDescription, rateDelayMs, scheduledAt } = await req.json()

  if (!subject || !body || !Array.isArray(contactIds) || contactIds.length === 0 || !scheduledAt) {
    return NextResponse.json({ error: 'subject, body, contactIds, and scheduledAt are required' }, { status: 400 })
  }

  const scheduledDate = new Date(scheduledAt)
  if (scheduledDate <= new Date()) {
    return NextResponse.json({ error: 'scheduledAt must be in the future' }, { status: 400 })
  }

  const { data, error } = await supabase.from('bulk_send_jobs').insert({
    user_id: user.id,
    template_id: templateId ?? null,
    subject,
    body,
    contact_ids: contactIds,
    filter_description: filterDescription ?? null,
    rate_delay_ms: rateDelayMs ?? 60000,
    status: 'scheduled',
    scheduled_at: scheduledDate.toISOString(),
    total_count: contactIds.length,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ job: data }, { status: 201 })
}
