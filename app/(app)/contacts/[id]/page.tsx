import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import ContactDetailClient from './client'

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: contact }, { data: notes }, { data: emails }] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id).single(),
    supabase.from('contact_notes').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
    supabase.from('email_history').select('id,subject,status,sent_at,created_at').eq('contact_id', id).order('created_at', { ascending: false }),
  ])

  if (!contact) notFound()

  return (
    <ContactDetailClient
      contact={contact}
      notes={notes ?? []}
      emails={emails ?? []}
    />
  )
}
