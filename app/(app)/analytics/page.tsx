'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { EmailHistory } from '@/lib/types'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts'
import { Zap, MessageSquare, TrendingUp, Users } from 'lucide-react'

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  hour: i,
  label: i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`,
}))

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type TemplateStats = {
  id: string
  name: string
  sent: number
  failed: number
  replies: number
  replyRate: number
}

function heatColor(count: number, max: number): string {
  if (count === 0) return '#f9fafb'
  const intensity = count / max
  const r = Math.round(59 + (16 - 59) * intensity)   // 59→16 (blue-500 → blue-800 r)
  const g = Math.round(130 + (185 - 130) * (1 - intensity)) // rough
  const b = Math.round(246 + (229 - 246) * intensity)
  // simpler: just use opacity on a blue background
  return `rgba(59,130,246,${0.1 + intensity * 0.85})`
}

export default function AnalyticsPage() {
  const [emails, setEmails] = useState<EmailHistory[]>([])
  const [templateStats, setTemplateStats] = useState<TemplateStats[]>([])
  const [inboxCount, setInboxCount] = useState(0)
  const [repliedContactIds, setRepliedContactIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()

    const [
      { data: emailData },
      { data: inboxData },
      { data: templateData },
    ] = await Promise.all([
      supabase.from('email_history').select('*').eq('user_id', user!.id).order('created_at', { ascending: true }),
      supabase.from('inbox_messages').select('contact_id, received_at').eq('user_id', user!.id),
      supabase.from('email_templates').select('id, name').eq('user_id', user!.id),
    ])

    const allEmails = emailData ?? []
    const allInbox = inboxData ?? []
    const allTemplates = templateData ?? []

    setEmails(allEmails)
    setInboxCount(allInbox.length)

    const inboxCids = new Set(allInbox.map(m => m.contact_id).filter(Boolean) as string[])
    setRepliedContactIds(inboxCids)

    // Template performance
    const stats: TemplateStats[] = allTemplates.map(t => {
      const tEmails = allEmails.filter(e => e.template_id === t.id)
      const sentList = tEmails.filter(e => e.status === 'sent')
      const failedCount = tEmails.filter(e => e.status === 'failed').length
      const sentCids = new Set(sentList.map(e => e.contact_id).filter(Boolean) as string[])
      const replies = [...sentCids].filter(id => inboxCids.has(id)).length
      return {
        id: t.id,
        name: t.name,
        sent: sentList.length,
        failed: failedCount,
        replies,
        replyRate: sentCids.size > 0 ? Math.round((replies / sentCids.size) * 100) : 0,
      }
    }).filter(s => s.sent > 0).sort((a, b) => b.sent - a.sent)

    setTemplateStats(stats)
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const sent = emails.filter(e => e.status === 'sent')
  const failed = emails.filter(e => e.status === 'failed')

  // Overall reply rate
  const sentCids = new Set(sent.map(e => e.contact_id).filter(Boolean) as string[])
  const repliedCount = [...sentCids].filter(id => repliedContactIds.has(id)).length
  const replyRate = sentCids.size > 0 ? Math.round((repliedCount / sentCids.size) * 100) : 0

  // ── Heatmap (day × hour) ──────────────────────────────────────────────────
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  sent.forEach(e => {
    if (!e.sent_at) return
    const d = new Date(e.sent_at)
    heatmap[d.getDay()][d.getHours()]++
  })
  const heatmapMax = Math.max(...heatmap.flat(), 1)

  // Best time: highest heatmap cell
  let bestDay = 1, bestHour = 9, bestCount = 0
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (heatmap[d][h] > bestCount) { bestCount = heatmap[d][h]; bestDay = d; bestHour = h }
    }
  }
  const bestHourLabel = bestHour === 0 ? '12:00 AM' : bestHour < 12 ? `${bestHour}:00 AM` : bestHour === 12 ? '12:00 PM' : `${bestHour - 12}:00 PM`
  const hasBestTime = bestCount > 0

  // ── Stacked volume by day (last 30 days) ─────────────────────────────────
  const stackedData = (() => {
    const map: Record<string, { date: string; sent: number; failed: number; scheduled: number }> = {}
    const today = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i)
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      map[key] = { date: key, sent: 0, failed: 0, scheduled: 0 }
    }
    emails.forEach(e => {
      const key = new Date(e.sent_at || e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      if (!(key in map)) return
      if (e.status === 'sent') map[key].sent++
      else if (e.status === 'failed') map[key].failed++
      else if (e.status === 'scheduled') map[key].scheduled++
    })
    return Object.values(map)
  })()

  // ── Contact engagement buckets ────────────────────────────────────────────
  const contactCounts: Record<string, number> = {}
  sent.forEach(e => { if (e.contact_id) contactCounts[e.contact_id] = (contactCounts[e.contact_id] ?? 0) + 1 })
  const once = Object.values(contactCounts).filter(n => n === 1).length
  const twice = Object.values(contactCounts).filter(n => n === 2).length
  const threeplus = Object.values(contactCounts).filter(n => n >= 3).length
  const totalEngaged = once + twice + threeplus

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Analytics</h1>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Sent', value: sent.length, color: 'text-green-600', sub: null },
          { label: 'Failed', value: failed.length, color: 'text-red-500', sub: (sent.length + failed.length) > 0 ? `${Math.round((failed.length / (sent.length + failed.length)) * 100)}% fail rate` : null },
          { label: 'Reply Rate', value: `${replyRate}%`, color: 'text-blue-600', sub: `${repliedCount} of ${sentCids.size} contacts replied` },
          { label: 'Inbox Replies', value: inboxCount, color: 'text-purple-600', sub: null },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-sm text-gray-500 mt-1">{s.label}</div>
            {s.sub && <div className="text-xs text-gray-400 mt-0.5">{s.sub}</div>}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : emails.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">Send some emails to see analytics.</div>
      ) : (
        <div className="space-y-6">

          {/* ── Best time to send callout ── */}
          {hasBestTime && (
            <div className="bg-blue-600 rounded-xl p-5 flex items-start gap-4 text-white">
              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
                <Zap size={20} className="text-white" />
              </div>
              <div>
                <p className="text-xs font-semibold text-blue-200 uppercase tracking-wide mb-0.5">Best Time to Send</p>
                <p className="text-lg font-bold">
                  We recommend sending on <span className="underline underline-offset-2">{DAYS_FULL[bestDay]}</span> at <span className="underline underline-offset-2">{bestHourLabel}</span>
                </p>
                <p className="text-sm text-blue-200 mt-1">
                  Based on your highest-volume send window — {bestCount} email{bestCount !== 1 ? 's' : ''} sent at this time.
                  {replyRate > 0 && ` Overall reply rate: ${replyRate}%.`}
                </p>
              </div>
            </div>
          )}

          {/* ── Day × Hour heatmap ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Send Volume Heatmap</h2>
            <p className="text-xs text-gray-400 mb-4">Day of week × hour of day — darker = more emails sent</p>
            <div className="overflow-x-auto">
              <div style={{ minWidth: 580 }}>
                {/* Hour labels */}
                <div className="flex mb-1 ml-10">
                  {HOURS.map(({ hour, label }) => (
                    <div key={hour} className="text-center text-gray-400 flex-1" style={{ fontSize: 9 }}>
                      {hour % 3 === 0 ? label : ''}
                    </div>
                  ))}
                </div>
                {/* Rows */}
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
                {/* Legend */}
                <div className="flex items-center gap-2 mt-3 ml-10">
                  <span className="text-xs text-gray-400">Low</span>
                  {[0.1, 0.3, 0.5, 0.7, 0.9].map(v => (
                    <div key={v} className="w-5 h-3 rounded-sm" style={{ backgroundColor: `rgba(59,130,246,${v})` }} />
                  ))}
                  <span className="text-xs text-gray-400">High</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Stacked daily volume: sent / failed / scheduled ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Daily Breakdown — Sent / Failed / Scheduled (Last 30 Days)</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stackedData} barSize={6}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="sent" stackId="a" fill="#22c55e" name="Sent" radius={[0, 0, 0, 0]} />
                <Bar dataKey="failed" stackId="a" fill="#ef4444" name="Failed" />
                <Bar dataKey="scheduled" stackId="a" fill="#f59e0b" name="Scheduled" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2">
              {[['Sent', '#22c55e'], ['Failed', '#ef4444'], ['Scheduled', '#f59e0b']].map(([label, color]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                  <span className="text-xs text-gray-500">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Volume over time (line) ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Email Volume Over Time (Last 30 Days)</h2>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={stackedData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="sent" stroke="#3b82f6" strokeWidth={2} dot={false} name="Emails Sent" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* ── Template performance table ── */}
          {templateStats.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={15} className="text-blue-600" />
                <h2 className="text-sm font-semibold text-gray-900">Template Performance</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="pb-2 font-medium">Template</th>
                    <th className="pb-2 font-medium text-right">Sent</th>
                    <th className="pb-2 font-medium text-right">Failed</th>
                    <th className="pb-2 font-medium text-right">Replies</th>
                    <th className="pb-2 font-medium text-right">Reply Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {templateStats.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="py-2.5 text-gray-900 font-medium">{t.name}</td>
                      <td className="py-2.5 text-right text-gray-700">{t.sent}</td>
                      <td className="py-2.5 text-right text-red-500">{t.failed > 0 ? t.failed : '—'}</td>
                      <td className="py-2.5 text-right text-gray-700">{t.replies}</td>
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
              <p className="text-xs text-gray-400 mt-3">Reply rate = contacts who replied ÷ contacts who received this template.</p>
            </div>
          )}

          {/* ── Contact engagement ── */}
          {totalEngaged > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Users size={15} className="text-purple-600" />
                <h2 className="text-sm font-semibold text-gray-900">Contact Engagement</h2>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-5">
                {[
                  { label: 'Emailed once', count: once, color: 'bg-blue-500', text: 'text-blue-600' },
                  { label: 'Emailed twice', count: twice, color: 'bg-purple-500', text: 'text-purple-600' },
                  { label: 'Emailed 3+ times', count: threeplus, color: 'bg-green-500', text: 'text-green-600' },
                ].map(s => (
                  <div key={s.label} className="text-center p-4 bg-gray-50 rounded-xl">
                    <div className={`text-3xl font-bold ${s.text}`}>{s.count}</div>
                    <div className="text-xs text-gray-500 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
              {/* Stacked bar */}
              <div className="h-3 rounded-full bg-gray-100 flex overflow-hidden">
                {totalEngaged > 0 && [
                  { count: once, color: 'bg-blue-500' },
                  { count: twice, color: 'bg-purple-500' },
                  { count: threeplus, color: 'bg-green-500' },
                ].map((s, i) => s.count > 0 && (
                  <div key={i} className={`${s.color} h-full`} style={{ width: `${(s.count / totalEngaged) * 100}%` }} />
                ))}
              </div>
              <div className="flex gap-4 mt-2">
                {[['Once', 'bg-blue-500'], ['Twice', 'bg-purple-500'], ['3+ times', 'bg-green-500']].map(([label, color]) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className={`w-2.5 h-2.5 rounded-sm ${color}`} />
                    <span className="text-xs text-gray-500">{label}</span>
                  </div>
                ))}
              </div>

              {/* Reply rate callout */}
              {replyRate > 0 && (
                <div className="mt-4 flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
                  <MessageSquare size={16} className="text-blue-500 shrink-0" />
                  <p className="text-sm text-blue-800">
                    <strong>{repliedCount}</strong> of {sentCids.size} contacted tenants have replied
                    — a <strong>{replyRate}%</strong> reply rate.
                  </p>
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  )
}
