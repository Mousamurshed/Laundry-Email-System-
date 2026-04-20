'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { EmailHistory } from '@/lib/types'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend
} from 'recharts'

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  hour: i,
  label: i === 0 ? '12am' : i < 12 ? `${i}am` : i === 12 ? '12pm' : `${i - 12}pm`,
}))

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function AnalyticsPage() {
  const [emails, setEmails] = useState<EmailHistory[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase
      .from('email_history')
      .select('*')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: true })
    setEmails(data ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const sent = emails.filter((e) => e.status === 'sent')
  const failed = emails.filter((e) => e.status === 'failed')
  const scheduled = emails.filter((e) => e.status === 'scheduled')

  // Volume by day (last 30 days)
  const volumeData = (() => {
    const counts: Record<string, number> = {}
    const today = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      counts[key] = 0
    }
    sent.forEach((e) => {
      if (!e.sent_at) return
      const d = new Date(e.sent_at)
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      if (key in counts) counts[key]++
    })
    return Object.entries(counts).map(([date, count]) => ({ date, count }))
  })()

  // Best send times by hour
  const hourData = HOURS.map(({ hour, label }) => ({
    label,
    count: sent.filter((e) => e.sent_at && new Date(e.sent_at).getHours() === hour).length,
  }))

  // By day of week
  const dayData = DAYS.map((day, i) => ({
    day,
    count: sent.filter((e) => e.sent_at && new Date(e.sent_at).getDay() === i).length,
  }))

  // Best performing hours (top 3)
  const bestHours = [...hourData]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .filter((h) => h.count > 0)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Analytics</h1>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Sent', value: sent.length, color: 'text-green-600' },
          { label: 'Scheduled', value: scheduled.length, color: 'text-yellow-600' },
          { label: 'Failed', value: failed.length, color: 'text-red-600' },
          { label: 'Total Emails', value: emails.length, color: 'text-blue-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-sm text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : emails.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">Send some emails to see analytics.</div>
      ) : (
        <div className="space-y-6">
          {/* Volume over time */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Email Volume (Last 30 Days)</h2>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={false} name="Emails Sent" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Best send times by hour */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-1">Best Send Times (by Hour)</h2>
              {bestHours.length > 0 && (
                <p className="text-xs text-gray-400 mb-3">
                  Top: {bestHours.map((h) => h.label).join(', ')}
                </p>
              )}
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hourData}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" name="Emails" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* By day of week */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Send Volume by Day of Week</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dayData}>
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8b5cf6" name="Emails" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Status breakdown */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Status Breakdown</h2>
            <div className="flex gap-6">
              {[
                { label: 'Sent', count: sent.length, color: 'bg-green-500' },
                { label: 'Scheduled', count: scheduled.length, color: 'bg-yellow-400' },
                { label: 'Failed', count: failed.length, color: 'bg-red-400' },
                { label: 'Cancelled', count: emails.filter((e) => e.status === 'cancelled').length, color: 'bg-gray-300' },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${s.color}`} />
                  <span className="text-sm text-gray-700">{s.label}: <strong>{s.count}</strong></span>
                </div>
              ))}
            </div>
            {emails.length > 0 && (
              <div className="mt-3 h-3 rounded-full bg-gray-100 flex overflow-hidden">
                {[
                  { count: sent.length, color: 'bg-green-500' },
                  { count: scheduled.length, color: 'bg-yellow-400' },
                  { count: failed.length, color: 'bg-red-400' },
                ].map((s, i) => s.count > 0 && (
                  <div
                    key={i}
                    className={`${s.color} h-full transition-all`}
                    style={{ width: `${(s.count / emails.length) * 100}%` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
