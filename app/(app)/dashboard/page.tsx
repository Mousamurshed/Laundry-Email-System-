import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { count: totalContacts },
    { count: dncCount },
    { count: totalSent },
    { count: scheduled },
    { data: recentEmails },
    { data: profile },
  ] = await Promise.all([
    supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('user_id', user!.id),
    supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('user_id', user!.id).eq('do_not_contact', true),
    supabase.from('email_history').select('*', { count: 'exact', head: true }).eq('user_id', user!.id).eq('status', 'sent'),
    supabase.from('email_history').select('*', { count: 'exact', head: true }).eq('user_id', user!.id).eq('status', 'scheduled'),
    supabase.from('email_history').select('id, to_email, to_name, subject, status, sent_at, created_at').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(5),
    supabase.from('profiles').select('full_name, gmail_email').eq('id', user!.id).single(),
  ])

  const stats = [
    { label: 'Total Contacts', value: totalContacts ?? 0, color: 'bg-blue-500', href: '/contacts' },
    { label: 'Emails Sent', value: totalSent ?? 0, color: 'bg-green-500', href: '/emails' },
    { label: 'Scheduled', value: scheduled ?? 0, color: 'bg-yellow-500', href: '/emails' },
    { label: 'Do Not Contact', value: dncCount ?? 0, color: 'bg-red-500', href: '/contacts' },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back{profile?.full_name ? `, ${profile.full_name}` : ''}
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {profile?.gmail_email ? (
            <>Connected as <span className="font-medium text-gray-700">{profile.gmail_email}</span></>
          ) : (
            <>
              <span className="text-amber-600">Gmail not connected.</span>{' '}
              <Link href="/settings" className="text-blue-600 hover:underline">Connect now</Link>
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
            <div className={`w-8 h-1 rounded-full ${s.color} mb-3`} />
            <div className="text-3xl font-bold text-gray-900">{s.value}</div>
            <div className="text-sm text-gray-500 mt-1">{s.label}</div>
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Recent Activity</h2>
          <Link href="/emails" className="text-sm text-blue-600 hover:underline">View all</Link>
        </div>

        {!recentEmails?.length ? (
          <div className="text-center py-10 text-gray-400 text-sm">
            No emails sent yet.{' '}
            <Link href="/emails" className="text-blue-600 hover:underline">Send your first email</Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="pb-3 font-medium">To</th>
                <th className="pb-3 font-medium">Subject</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentEmails.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="py-2.5 text-gray-700">{e.to_name || e.to_email}</td>
                  <td className="py-2.5 text-gray-600 max-w-xs truncate">{e.subject}</td>
                  <td className="py-2.5">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="py-2.5 text-gray-400">{formatDate(e.sent_at || e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        <QuickAction href="/contacts" emoji="👥" label="Add Contact" desc="Manage your contact list" />
        <QuickAction href="/templates" emoji="✉️" label="Create Template" desc="Design email templates" />
        <QuickAction href="/emails" emoji="📨" label="Send Email" desc="Reach out to contacts" />
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    sent: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    scheduled: 'bg-yellow-100 text-yellow-700',
    cancelled: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function QuickAction({ href, emoji, label, desc }: { href: string; emoji: string; label: string; desc: string }) {
  return (
    <Link href={href} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow flex items-start gap-3">
      <span className="text-2xl">{emoji}</span>
      <div>
        <div className="text-sm font-semibold text-gray-900">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
      </div>
    </Link>
  )
}
