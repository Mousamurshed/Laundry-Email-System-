import { createClient } from '@/lib/supabase/server'
import { getGmailClient } from '@/lib/gmail'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let gmail
  try {
    gmail = await getGmailClient(user.id)
  } catch {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })
  }

  // Get sent emails from the last 30 days that have a contact attached
  const since30d = new Date()
  since30d.setDate(since30d.getDate() - 30)

  const { data: sentEmails } = await supabase
    .from('email_history')
    .select('id, contact_id, to_email, subject')
    .eq('user_id', user.id)
    .eq('status', 'sent')
    .not('contact_id', 'is', null)
    .gte('sent_at', since30d.toISOString())

  if (!sentEmails?.length) return NextResponse.json({ detected: 0 })

  // Build a map of email -> contact_id for quick lookup
  const emailToContact: Record<string, string> = {}
  for (const e of sentEmails) {
    if (e.to_email && e.contact_id) emailToContact[e.to_email.toLowerCase()] = e.contact_id
  }

  // Query Gmail inbox for messages from those senders (in:inbox is:unread OR all)
  const uniqueEmails = [...new Set(sentEmails.map((e) => e.to_email?.toLowerCase()).filter(Boolean))]

  let detected = 0
  const updatedContacts = new Set<string>()

  // Check for replies in batches of 10 senders
  for (let i = 0; i < uniqueEmails.length; i += 10) {
    const batch = uniqueEmails.slice(i, i + 10)
    const query = batch.map((e) => `from:${e}`).join(' OR ')

    try {
      const { data } = await gmail.users.messages.list({
        userId: 'me',
        q: `(${query}) in:inbox`,
        maxResults: 50,
      })

      for (const msg of data.messages ?? []) {
        const { data: full } = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Reply-To'],
        })

        const fromHeader = full.payload?.headers?.find((h) => h.name === 'From')?.value ?? ''
        // Extract email from "Name <email>" format
        const match = fromHeader.match(/<(.+?)>/) ?? fromHeader.match(/(\S+@\S+)/)
        const fromEmail = (match?.[1] ?? fromHeader).toLowerCase().trim()

        const contactId = emailToContact[fromEmail]
        if (contactId && !updatedContacts.has(contactId)) {
          await supabase
            .from('contacts')
            .update({ status: 'responded' })
            .eq('id', contactId)
            .neq('status', 'responded') // only update if not already marked

          updatedContacts.add(contactId)
          detected++
        }
      }
    } catch {
      // Skip if query fails for this batch
      continue
    }
  }

  return NextResponse.json({ detected, contactsUpdated: [...updatedContacts] })
}
