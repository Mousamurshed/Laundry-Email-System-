import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react'

const DAILY_LIMIT = 500
const WARN_THRESHOLD = 400

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  const [
    { count: totalContacts },
    { count: dncCount },
    { count: totalSent },
    { count: scheduled },
    { count: sentToday },
    { data: recentEmails },
    { data: profile },
  ] = await Promise.all([
    supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('user_id', user!.id),
    supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('user_id', user!.id).eq('do_not_contact', true),
    supabase.from('email_history').select('*', { count: 'exact', head: true }).eq('user_id', user!.id).eq('status', 'sent'),
    supabase.from('email_history').select('*', { count: 'exact', head: true }).eq('user_id', user!.id).eq('status', 'scheduled'),
    supabase.from('email_history').select('*', { count: 'exact', head: true }).eq('user_id', user!.id).eq('status', 'sent').gte('sent_at', todayStart.toISOString()),
    supabase.from('email_history').select('id,to_email,to_name,subject,status,sent_at,created_at').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(5),
    supabase.from('profiles').select('full_name,gmail_email').eq('id', user!.id).single(),
  ])

  const todaySent = sentToday ?? 0
  const remaining = DAILY_LIMIT - todaySent
  const pct = Math.min((todaySent / DAILY_LIMIT) * 100, 100)
  const nearLimit = todaySent >= WARN_THRESHOLD

  const stats = [
    { label: 'Total Contacts', value: totalContacts ?? 0, color: 'bg-blue-500', href: '/contacts' },
    { label: 'Emails Sent', value: totalSent ?? 0, color: 'bg-green-500', href: '/emails' },
    { label: 'Scheduled', value: scheduled ?? 0, color: 'bg-yellow-500', href: '/emails' },
    { label: 'Do Not Contact', value: dncCount ?? 0, color: 'bg-red-500', href: '/contacts' },
  ]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back{profile?.full_name ? `, ${profile.full_name}` : ''}
        </h1>
      </div>

      {/* Gmail status card */}
      <div className={`rounded-xl border p-4 mb-6 flex items-center justify-between ${profile?.gmail_email ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        <div className="flex items-center gap-3">
          {profile?.gmail_email ? (
            <>
              <CheckCircle size={20} className="text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-900">Gmail Connected</p>
                <p className="text-xs text-green-700">{profile.gmail_email}</p>
              </div>
            </>
          ) : (
            <>
              <XCircle size={20} className="text-amber-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-900">Gmail Not Connected</p>
                <p className="text-xs text-amber-700">You need to connect Gmail before sending emails.</p>
              </div>
            </>
          )}
        </div>
        {!profile?.gmail_email && (
          <Link href="/api/gmail/auth"
            className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium shrink-0">
            Connect Gmail
          </Link>
        )}
        {profile?.gmail_email && (
          <div className="text-right shrink-0">
            <div className={`text-sm font-semibold ${nearLimit ? 'text-amber-700' : 'text-green-700'}`}>
              {nearLimit && <AlertTriangle size={13} className="inline mr-1" />}
              {todaySent} / {DAILY_LIMIT} today
            </div>
            <div className="w-32 h-1.5 bg-green-200 rounded-full mt-1 overflow-hidden">
              <div
                className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-green-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-xs text-green-600 mt-0.5">{remaining} remaining</div>
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
            <div className={`w-8 h-1 rounded-full ${s.color} mb-3`} />
            <div className="text-3xl font-bold text-gray-900">{s.value}</div>
            <div className="text-sm text-gray-500 mt-1">{s.label}</div>
          </Link>
        ))}
      </div>

      {/* Recent activity */}
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
                  <td className="py-2.5 text-gray-900">{e.to_name || e.to_email}</td>
                  <td className="py-2.5 text-gray-700 max-w-xs truncate">{e.subject}</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      e.status === 'sent' ? 'bg-green-100 text-green-700' :
                      e.status === 'failed' ? 'bg-red-100 text-red-700' :
                      e.status === 'scheduled' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-600'}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="py-2.5 text-gray-500">{formatDate(e.sent_at || e.created_at)}</td>
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
