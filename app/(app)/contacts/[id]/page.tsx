import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatDateTime } from '@/lib/utils'
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
    supabase.from('email_history').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
  ])

  if (!contact) notFound()

  return (
    <div>
      <div className="mb-6">
        <Link href="/contacts" className="text-sm text-gray-500 hover:text-gray-700">← Contacts</Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{contact.name}</h1>
            <p className="text-gray-500 text-sm">{contact.email}</p>
          </div>
          {contact.do_not_contact && (
            <span className="px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded-full">Do Not Contact</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Contact Info</h2>
          <dl className="space-y-3 text-sm">
            {[
              ['Company', contact.company],
              ['Phone', contact.phone],
              ['Address', contact.address],
              ['Status', contact.status],
              ['Added', formatDateTime(contact.created_at)],
            ].map(([label, value]) => value && (
              <div key={label}>
                <dt className="text-gray-400 text-xs">{label}</dt>
                <dd className="text-gray-700 mt-0.5">{value}</dd>
              </div>
            ))}
            {contact.tags?.length > 0 && (
              <div>
                <dt className="text-gray-400 text-xs">Tags</dt>
                <dd className="flex flex-wrap gap-1 mt-1">
                  {contact.tags.map((t: string) => (
                    <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">{t}</span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* Notes & Email History */}
        <div className="lg:col-span-2 space-y-6">
          <ContactDetailClient contactId={id} initialNotes={notes ?? []} />

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Email History ({emails?.length ?? 0})</h2>
            {!emails?.length ? (
              <p className="text-sm text-gray-400">No emails sent to this contact yet.</p>
            ) : (
              <div className="space-y-3">
                {emails.map((e) => (
                  <div key={e.id} className="border border-gray-100 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800">{e.subject}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        e.status === 'sent' ? 'bg-green-100 text-green-700' :
                        e.status === 'failed' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{e.status}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{formatDateTime(e.sent_at || e.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
