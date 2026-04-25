import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })

  const { data: msg } = await supabase
    .from('inbox_messages')
    .select('subject, body_full, from_name, from_email')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

  const prompt = `You are classifying an email reply from a potential laundry service customer.

From: ${msg.from_name ?? msg.from_email}
Subject: ${msg.subject ?? '(no subject)'}
Message:
${(msg.body_full ?? '').slice(0, 2000)}

Classify this reply into exactly one of these three categories:
- interested: The person wants to learn more, wants a quote, or is open to the service
- not_interested: The person clearly declines, says no, or is not interested
- needs_more_info: The reply is ambiguous, asks questions, or needs follow-up

Reply with ONLY a JSON object in this format:
{"classification": "interested"|"not_interested"|"needs_more_info", "reason": "one sentence explanation"}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: `Claude API error: ${err}` }, { status: 502 })
  }

  const aiRes = await res.json() as { content: { type: string; text: string }[] }
  const text = aiRes.content.find(c => c.type === 'text')?.text ?? ''

  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text) as {
      classification: string
      reason: string
    }
    return NextResponse.json({ classification: parsed.classification, reason: parsed.reason })
  } catch {
    return NextResponse.json({ error: 'Could not parse AI response', raw: text }, { status: 502 })
  }
}
