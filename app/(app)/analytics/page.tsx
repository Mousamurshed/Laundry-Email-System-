'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { TrendingUp, Users, Mail, Layers } from 'lucide-react'

// ── Slim local types (we select only what we need) ────────────────────────────

type SlimEmail = {
  status: string
  sent_at: string | null
  created_at: string
  contact_id: string | null
  template_id: string | null
}

type SlimContact = {
  id: string
  status: string
  do_not_contact: boolean
}

type TemplateRow = { id: string; name: string }

type BulkJob = {
  id: string
  scheduled_at: string
  started_at: string | null
  completed_at: string | null
  total_count: number
  sent_count: number
  failed_count: number
  filter_description: string | null
}

type TemplateStats = {
  id: string
  name: string
  sent: number
  failed: number
  replies: number
  replyRate: number
  deliveryRate: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => ({
  hour: i,
  label: i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`,
}))

const STATUS_ORDER = [
  'confirmed', 'responded', 'interested', 'customer',
  'active', 'prospect', 'new', 'inactive', 'not_interested',
]
const STATUS_COLOR: Record<string, string> = {
  confirmed: '#22c55e',
  responded: '#3b82f6',
  interested: '#8b5cf6',
  customer: '#06b6d4',
  active: '#10b981',
  prospect: '#f59e0b',
  new: '#94a3b8',
  inactive: '#cbd5e1',
  not_interested: '#ef4444',
}
const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  responded: 'Responded',
  interested: 'Interested',
  customer: 'Customer',
  active: 'Active',
  prospect: 'Prospect',
  new: 'New',
  inactive: 'Inactive',
  not_interested: 'Not Interested',
}

function heatColor(count: number, max: number): string {
  if (count === 0) return '#f9fafb'
  return `rgba(59,130,246,${0.12 + (count / max) * 0.82})`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [emails, setEmails] = useState<SlimEmail[]>([])
  const [contacts, setContacts] = useState<SlimContact[]>([])
  const [inboxCids, setInboxCids] = useState<Set<string>>(new Set())
  const [templateStats, setTemplateStats] = useState<TemplateStats[]>([])
  const [bulkJobs, setBulkJobs] = useState<BulkJob[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()

    const [
      { data: emailData },
      { data: contactData },
      { data: inboxData },
      { data: templateData },
      { data: jobsData },
    ] = await Promise.all([
      supabase
        .from('email_history')
        .select('status, sent_at, created_at, contact_id, template_id')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('contacts')
        .select('id, status, do_not_contact')
        .eq('user_id', user!.id),
      supabase
        .from('inbox_messages')
        .select('contact_id')
        .eq('user_id', user!.id),
      supabase
        .from('email_templates')
        .select('id, name')
        .eq('user_id', user!.id),
      supabase
        .from('bulk_send_jobs')
        .select('id, scheduled_at, started_at, completed_at, total_count, sent_count, failed_count, filter_description')
        .eq('user_id', user!.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(10),
    ])

    const allEmails = (emailData ?? []) as SlimEmail[]
    const allContacts = (contactData ?? []) as SlimContact[]
    const allTemplates = (templateData ?? []) as TemplateRow[]

    const cids = new Set(
      ((inboxData ?? []) as { contact_id: string | null }[])
        .map(m => m.contact_id)
        .filter(Boolean) as string[]
    )

    setEmails(allEmails)
    setContacts(allContacts)
    setInboxCids(cids)
    setBulkJobs((jobsData ?? []) as BulkJob[])

    // Template performance
    const sentEmails = allEmails.filter(e => e.status === 'sent')
    const stats: TemplateStats[] = allTemplates.map(t => {
      const tAll = allEmails.filter(e => e.template_id === t.id)
      const tSent = tAll.filter(e => e.status === 'sent')
      const tFailed = tAll.filter(e => e.status === 'failed').length
      const sentCids = new Set(tSent.map(e => e.contact_id).filter(Boolean) as string[])
      const replies = [...sentCids].filter(id => cids.has(id)).length
      const total = tSent.length + tFailed
      return {
        id: t.id,
        name: t.name,
        sent: tSent.length,
        failed: tFailed,
        replies,
        replyRate: sentCids.size > 0 ? Math.round((replies / sentCids.size) * 100) : 0,
        deliveryRate: total > 0 ? Math.round((tSent.length / total) * 100) : 100,
      }
    }).filter(s => s.sent > 0 || s.failed > 0).sort((a, b) => b.sent - a.sent)

    void sentEmails // used above via allEmails
    setTemplateStats(stats)
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  // ── Derived metrics ───────────────────────────────────────────────────────
  const sent = emails.filter(e => e.status === 'sent')
  const failed = emails.filter(e => e.status === 'failed')
  const totalAttempted = sent.length + failed.length
  const deliveryRate = totalAttempted > 0 ? Math.round((sent.length / totalAttempted) * 100) : 100

  const emailedCids = new Set(sent.map(e => e.contact_id).filter(Boolean) as string[])
  const uniqueEmailed = emailedCids.size
  const repliedCount = [...emailedCids].filter(id => inboxCids.has(id)).length
  const replyRate = uniqueEmailed > 0 ? Math.round((repliedCount / uniqueEmailed) * 100) : 0

  const totalContacts = contacts.length
  const confirmedCount = contacts.filter(c => c.status === 'confirmed').length

  // Contact status breakdown
  const statusCounts: Record<string, number> = {}
  contacts.forEach(c => { statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1 })

  // Contact engagement depth
  const contactFreq: Record<string, number> = {}
  sent.forEach(e => { if (e.contact_id) contactFreq[e.contact_id] = (contactFreq[e.contact_id] ?? 0) + 1 })
  const once = Object.values(contactFreq).filter(n => n === 1).length
  const twice = Object.values(contactFreq).filter(n => n === 2).length
  const threeplus = Object.values(contactFreq).filter(n => n >= 3).length
  const totalEngaged = once + twice + threeplus

  // 30-day chart
  const chartData = (() => {
    const map: Record<string, { date: string; sent: number; failed: number }> = {}
    const today = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i)
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      map[key] = { date: key, sent: 0, failed: 0 }
    }
    emails.forEach(e => {
      const key = new Date(e.sent_at || e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      if (!(key in map)) return
      if (e.status === 'sent') map[key].sent++
      else if (e.status === 'failed') map[key].failed++
    })
    return Object.values(map)
  })()

  // Send heatmap (day × hour)
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  sent.forEach(e => {
    if (!e.sent_at) return
    const d = new Date(e.sent_at)
    heatmap[d.getDay()][d.getHours()]++
  })
  const heatmapMax = Math.max(...heatmap.flat(), 1)

  // Funnel
  const funnelSteps = [
    { label: 'Total Contacts', count: totalContacts, color: '#94a3b8' },
    { label: 'Emailed', count: uniqueEmailed, color: '#3b82f6' },
    { label: 'Replied', count: repliedCount, color: '#8b5cf6' },
    { label: 'Confirmed', count: confirmedCount, color: '#22c55e' },
  ]
  const funnelMax = Math.max(totalContacts, 1)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Analytics</h1>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          {
            label: 'Total Sent',
            value: sent.length.toLocaleString(),
            sub: failed.length > 0 ? `${failed.length} failed` : 'No failures',
            color: 'text-green-600',
          },
          {
            label: 'Delivery Rate',
            value: totalAttempted > 0 ? `${deliveryRate}%` : '—',
            sub: totalAttempted > 0 ? `${totalAttempted.toLocaleString()} attempted` : 'No sends yet',
            color: deliveryRate >= 95 ? 'text-green-600' : deliveryRate >= 85 ? 'text-amber-500' : 'text-red-500',
          },
          {
            label: 'Contacts Reached',
            value: uniqueEmailed.toLocaleString(),
            sub: replyRate > 0 ? `${replyRate}% reply rate` : 'No replies detected',
            color: 'text-blue-600',
          },
          {
            label: 'Confirmed Tenants',
            value: confirmedCount.toLocaleString(),
            sub: totalContacts > 0 ? `${Math.round((confirmedCount / totalContacts) * 100)}% of contacts` : '—',
            color: 'text-purple-600',
          },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-sm font-medium text-gray-700 mt-1">{s.label}</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : sent.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">Send some emails to see analytics.</div>
      ) : (
        <div className="space-y-6">

          {/* ── Outreach funnel ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Outreach Funnel</h2>
            <div className="space-y-2.5">
              {funnelSteps.map((step, i) => {
                const widthPct = Math.round((step.count / funnelMax) * 100)
                const convPct = i > 0 && funnelSteps[i - 1].count > 0
                  ? Math.round((step.count / funnelSteps[i - 1].count) * 100)
                  : null
                return (
                  <div key={step.label} className="flex items-center gap-3">
                    <div className="w-32 shrink-0 text-xs font-medium text-gray-600">{step.label}</div>
                    <div className="flex-1 h-7 bg-gray-100 rounded-md overflow-hidden">
                      <div
                        className="h-full rounded-md transition-all duration-500"
                        style={{
                          width: `${step.count > 0 ? Math.max(widthPct, 2) : 0}%`,
                          backgroundColor: step.color,
                        }}
                      />
                    </div>
                    <div className="w-24 shrink-0 text-right">
                      <span className="text-sm font-bold text-gray-900">{step.count.toLocaleString()}</span>
                      {convPct !== null && (
                        <span className="text-xs text-gray-400 ml-2">{convPct}%</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">% shows conversion from the previous step.</p>
          </div>

          {/* ── 30-day activity ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Email Activity — Last 30 Days</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barSize={9} barGap={1}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={30} />
                <Tooltip />
                <Bar dataKey="sent" stackId="a" fill="#22c55e" name="Sent" />
                <Bar dataKey="failed" stackId="a" fill="#ef4444" name="Failed" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2">
              {([['Sent', '#22c55e'], ['Failed', '#ef4444']] as const).map(([label, color]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                  <span className="text-xs text-gray-500">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Contact status + engagement depth (side by side) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {totalContacts > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Users size={14} className="text-blue-500" />
                  <h2 className="text-sm font-semibold text-gray-900">Contact Status</h2>
                  <span className="ml-auto text-xs text-gray-400">{totalContacts} total</span>
                </div>
                <div className="space-y-2">
                  {STATUS_ORDER.filter(s => (statusCounts[s] ?? 0) > 0).map(s => {
                    const count = statusCounts[s]
                    const pct = Math.round((count / totalContacts) * 100)
                    return (
                      <div key={s} className="flex items-center gap-2">
                        <div className="w-24 shrink-0 text-xs text-gray-600">{STATUS_LABEL[s]}</div>
                        <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                          <div
                            className="h-full rounded"
                            style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: STATUS_COLOR[s] }}
                          />
                        </div>
                        <div className="text-xs font-medium text-gray-700 w-8 text-right">{count}</div>
                        <div className="text-xs text-gray-400 w-8 text-right">{pct}%</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {totalEngaged > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Mail size={14} className="text-purple-500" />
                  <h2 className="text-sm font-semibold text-gray-900">Engagement Depth</h2>
                  <span className="ml-auto text-xs text-gray-400">{totalEngaged} contacts</span>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: 'Emailed once', count: once, bg: '#eff6ff', color: '#3b82f6' },
                    { label: 'Emailed twice', count: twice, bg: '#f5f3ff', color: '#8b5cf6' },
                    { label: 'Emailed 3+', count: threeplus, bg: '#f0fdf4', color: '#22c55e' },
                  ].map(s => (
                    <div key={s.label} className="text-center p-3 rounded-xl" style={{ backgroundColor: s.bg }}>
                      <div className="text-2xl font-bold" style={{ color: s.color }}>{s.count}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
                <div className="h-2.5 rounded-full bg-gray-100 flex overflow-hidden">
                  {[
                    { count: once, color: '#3b82f6' },
                    { count: twice, color: '#8b5cf6' },
                    { count: threeplus, color: '#22c55e' },
                  ].filter(s => s.count > 0).map((s, i) => (
                    <div
                      key={i}
                      className="h-full"
                      style={{ width: `${(s.count / totalEngaged) * 100}%`, backgroundColor: s.color }}
                    />
                  ))}
                </div>
                {replyRate > 0 && (
                  <p className="text-xs text-gray-500 mt-3">
                    <span className="font-semibold text-gray-800">{repliedCount}</span> of {uniqueEmailed} emailed contacts replied —{' '}
                    <span className="font-semibold text-blue-600">{replyRate}% reply rate</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Template performance ── */}
          {templateStats.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={14} className="text-blue-600" />
                <h2 className="text-sm font-semibold text-gray-900">Template Performance</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[500px]">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="pb-2 font-medium">Template</th>
                      <th className="pb-2 font-medium text-right">Sent</th>
                      <th className="pb-2 font-medium text-right">Failed</th>
                      <th className="pb-2 font-medium text-right">Delivery</th>
                      <th className="pb-2 font-medium text-right">Replies</th>
                      <th className="pb-2 font-medium text-right">Reply Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {templateStats.map(t => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="py-2.5 font-medium text-gray-900 max-w-[160px] truncate">{t.name}</td>
                        <td className="py-2.5 text-right text-gray-700">{t.sent}</td>
                        <td className="py-2.5 text-right text-red-500">{t.failed > 0 ? t.failed : '—'}</td>
                        <td className="py-2.5 text-right">
                          <span className={`text-xs font-semibold ${t.deliveryRate >= 95 ? 'text-green-600' : t.deliveryRate >= 85 ? 'text-amber-500' : 'text-red-500'}`}>
                            {t.deliveryRate}%
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-gray-700">{t.replies > 0 ? t.replies : '—'}</td>
                        <td className="py-2.5 text-right">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                            t.replyRate >= 20 ? 'bg-green-100 text-green-700'
                            : t.replyRate >= 10 ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-500'
                          }`}>
                            {t.replyRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-3">Delivery = sent ÷ (sent + failed). Reply rate = contacts who replied ÷ contacts emailed with this template.</p>
            </div>
          )}

          {/* ── Bulk campaign history ── */}
          {bulkJobs.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Layers size={14} className="text-green-600" />
                <h2 className="text-sm font-semibold text-gray-900">Bulk Campaign History</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[500px]">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium hidden sm:table-cell">Description</th>
                      <th className="pb-2 font-medium text-right">Targeted</th>
                      <th className="pb-2 font-medium text-right">Sent</th>
                      <th className="pb-2 font-medium text-right">Failed</th>
                      <th className="pb-2 font-medium text-right">Delivery</th>
                      <th className="pb-2 font-medium text-right hidden md:table-cell">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {bulkJobs.map(job => {
                      const total = job.sent_count + job.failed_count
                      const dr = total > 0 ? Math.round((job.sent_count / total) * 100) : 100
                      return (
                        <tr key={job.id} className="hover:bg-gray-50">
                          <td className="py-2.5 text-gray-700 whitespace-nowrap">{fmtDate(job.completed_at ?? job.scheduled_at)}</td>
                          <td className="py-2.5 text-gray-500 hidden sm:table-cell max-w-[200px] truncate">{job.filter_description ?? '—'}</td>
                          <td className="py-2.5 text-right text-gray-700">{job.total_count}</td>
                          <td className="py-2.5 text-right font-medium text-green-600">{job.sent_count}</td>
                          <td className="py-2.5 text-right text-red-500">{job.failed_count > 0 ? job.failed_count : '—'}</td>
                          <td className="py-2.5 text-right">
                            <span className={`text-xs font-semibold ${dr >= 95 ? 'text-green-600' : dr >= 85 ? 'text-amber-500' : 'text-red-500'}`}>
                              {dr}%
                            </span>
                          </td>
                          <td className="py-2.5 text-right text-gray-400 hidden md:table-cell">{fmtDuration(job.started_at, job.completed_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Send volume heatmap ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Send Volume Heatmap</h2>
            <p className="text-xs text-gray-400 mb-4">Day of week × hour of day — darker = more emails sent</p>
            <div className="overflow-x-auto">
              <div style={{ minWidth: 580 }}>
                <div className="flex mb-1 ml-10">
                  {HOURS.map(({ hour, label }) => (
                    <div key={hour} className="text-center text-gray-400 flex-1" style={{ fontSize: 9 }}>
                      {hour % 3 === 0 ? label : ''}
                    </div>
                  ))}
                </div>
                {DAYS.map((day, d) => (
                  <div key={day} className="flex items-center mb-0.5">
                    <div className="w-10 text-xs text-gray-500 font-medium shrink-0">{day}</div>
                    {HOURS.map(({ hour }) => {
                      const count = heatmap[d][hour]
                      return (
                        <div
                          key={hour}
                          title={`${day} ${HOURS[hour].label}: ${count} email${count !== 1 ? 's' : ''}`}
                          className="flex-1 rounded-sm mx-px"
                          style={{ height: 22, backgroundColor: heatColor(count, heatmapMax) }}
                        />
                      )
                    })}
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-3 ml-10">
                  <span className="text-xs text-gray-400">Low</span>
                  {[0.12, 0.3, 0.5, 0.7, 0.94].map(v => (
                    <div key={v} className="w-5 h-3 rounded-sm" style={{ backgroundColor: `rgba(59,130,246,${v})` }} />
                  ))}
                  <span className="text-xs text-gray-400">High</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
