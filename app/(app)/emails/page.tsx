'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Contact, EmailTemplate, EmailHistory } from '@/lib/types'
import { formatDateTime, replacePlaceholders, STATUS_COLORS, insertAtCursor } from '@/lib/utils'
import { Send, Clock, AlertTriangle, Eye } from 'lucide-react'

const PLACEHOLDERS = ['{{name}}', '{{email}}', '{{company}}', '{{address}}', '{{phone}}']
const DAILY_LIMIT = 500
const WARN_THRESHOLD = 400

export default function EmailsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [history, setHistory] = useState<EmailHistory[]>([])
  const [sentToday, setSentToday] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showCompose, setShowCompose] = useState(false)
  const supabase = createClient()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

    const [{ data: c }, { data: t }, { data: h }, { count: todayCount }] = await Promise.all([
      supabase.from('contacts').select('*').eq('user_id', user!.id).eq('do_not_contact', false).order('name'),
      supabase.from('email_templates').select('*').eq('user_id', user!.id).order('name'),
      supabase.from('email_history').select('*, contacts(name,email), email_templates(name)').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('email_history').select('*', { count: 'exact', head: true }).eq('user_id', user!.id).eq('status', 'sent').gte('sent_at', todayStart.toISOString()),
    ])
    setContacts(c ?? [])
    setTemplates(t ?? [])
    setHistory(h ?? [])
    setSentToday(todayCount ?? 0)
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function cancelScheduled(id: string) {
    await supabase.from('email_history').update({ status: 'cancelled' }).eq('id', id)
    load()
  }

  const pct = Math.min((sentToday / DAILY_LIMIT) * 100, 100)
  const nearLimit = sentToday >= WARN_THRESHOLD

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Send Email</h1>
        <button onClick={() => setShowCompose(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <Send size={14} /> Compose Email
        </button>
      </div>

      {/* Daily send limit bar */}
      <div className={`rounded-xl border p-4 mb-6 ${nearLimit ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {nearLimit && <AlertTriangle size={15} className="text-amber-500" />}
            <span className="text-sm font-medium text-gray-900">Daily Send Usage</span>
          </div>
          <span className={`text-sm font-semibold ${nearLimit ? 'text-amber-700' : 'text-gray-700'}`}>
            {sentToday} / {DAILY_LIMIT}
          </span>
        </div>
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-green-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {nearLimit && (
          <p className="text-xs text-amber-700 mt-1.5">
            {sentToday >= DAILY_LIMIT ? 'Daily Gmail limit reached. Sending will fail.' : `Approaching Gmail's 500/day limit — ${DAILY_LIMIT - sentToday} remaining.`}
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Email History</h2>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
        ) : history.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No emails yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3 font-medium">To</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Template</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Date</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{e.to_name || e.to_email}</div>
                    <div className="text-xs text-gray-500">{e.to_email}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-900 max-w-xs truncate">{e.subject}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell text-xs">
                    {(e.email_templates as { name: string } | null)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[e.status]}`}>{e.status}</span>
                    {e.status === 'scheduled' && e.scheduled_at && (
                      <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                        <Clock size={10} /> {formatDateTime(e.scheduled_at)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{formatDateTime(e.sent_at || e.created_at)}</td>
                  <td className="px-4 py-3">
                    {e.status === 'scheduled' && (
                      <button onClick={() => cancelScheduled(e.id)} className="text-xs text-red-400 hover:text-red-600">Cancel</button>
                    )}
                    {e.status === 'failed' && e.error_message && (
                      <span className="text-xs text-red-500 truncate max-w-[100px]" title={e.error_message}>
                        Error: {e.error_message.slice(0, 30)}…
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCompose && (
        <ComposeModal
          contacts={contacts}
          templates={templates}
          sentToday={sentToday}
          onClose={() => setShowCompose(false)}
          onSent={() => { setShowCompose(false); load() }}
        />
      )}
    </div>
  )
}

// ── Compose Modal ─────────────────────────────────────────────────────────────
function ComposeModal({ contacts, templates, sentToday, onClose, onSent }: {
  contacts: Contact[]; templates: EmailTemplate[]; sentToday: number
  onClose: () => void; onSent: () => void
}) {
  const [mode, setMode] = useState<'contact' | 'manual'>('contact')
  const [contactId, setContactId] = useState('')
  const [manualEmail, setManualEmail] = useState('')
  const [manualName, setManualName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [scheduleMode, setScheduleMode] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [lastFocus, setLastFocus] = useState<'subject' | 'body'>('body')
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const selectedContact = contacts.find((c) => c.id === contactId)
  const selectedTemplate = templates.find((t) => t.id === templateId)

  const contactData = selectedContact
    ? { name: selectedContact.name, email: selectedContact.email, company: selectedContact.company ?? '', address: selectedContact.address ?? '', phone: selectedContact.phone ?? '' }
    : { name: manualName, email: manualEmail, company: '', address: '', phone: '' }

  useEffect(() => {
    if (!selectedTemplate) return
    setSubject(replacePlaceholders(selectedTemplate.subject, contactData))
    setBody(replacePlaceholders(selectedTemplate.body, contactData))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, contactId])

  function insertPh(ph: string) {
    if (lastFocus === 'subject' && subjectRef.current) {
      insertAtCursor(subjectRef.current, ph, setSubject)
    } else if (bodyRef.current) {
      insertAtCursor(bodyRef.current, ph, setBody)
    }
  }

  // Preview: replace placeholders in current subject/body with contact data
  const previewSubject = replacePlaceholders(subject, contactData)
  const previewBody = replacePlaceholders(body, contactData)

  async function send() {
    const toEmail = mode === 'contact' ? selectedContact?.email : manualEmail
    if (!toEmail || !subject || !body) { setError('Recipient, subject and body are required.'); return }
    setSending(true); setError('')

    const res = await fetch('/api/emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactId: mode === 'contact' ? contactId : null,
        templateId: templateId || null,
        toEmail,
        toName: mode === 'contact' ? selectedContact?.name : manualName || null,
        subject: previewSubject,
        body: previewBody,
        scheduleAt: scheduleMode && scheduleAt ? scheduleAt : null,
      }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Failed to send'); setSending(false) }
    else onSent()
  }

  const remaining = DAILY_LIMIT - sentToday
  const atLimit = sentToday >= DAILY_LIMIT

  if (showPreview) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-xl">
          <div className="flex items-center justify-between p-5 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Email Preview</h2>
            <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="p-5">
            <div className="mb-4 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              To: <span className="font-medium text-gray-900">{mode === 'contact' ? `${selectedContact?.name ?? ''} <${selectedContact?.email}>` : `${manualName} <${manualEmail}>`}</span>
            </div>
            <p className="text-xs text-gray-400 mb-1">Subject</p>
            <p className="text-sm font-semibold text-gray-900 mb-4">{previewSubject || '(no subject)'}</p>
            <hr className="border-gray-100 mb-4" />
            <p className="text-sm text-gray-900 whitespace-pre-wrap">{previewBody || '(empty body)'}</p>
            {scheduleMode && scheduleAt && (
              <p className="text-xs text-amber-600 mt-4 flex items-center gap-1"><Clock size={12} /> Scheduled for {new Date(scheduleAt).toLocaleString()}</p>
            )}
          </div>
          <div className="flex justify-between gap-2 p-5 border-t border-gray-100">
            <button onClick={() => setShowPreview(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">← Back to Edit</button>
            <button onClick={send} disabled={sending || atLimit}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {sending ? 'Sending…' : scheduleMode ? <><Clock size={13} /> Schedule</> : <><Send size={13} /> Send Now</>}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Compose Email</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Daily limit warning */}
          {sentToday >= WARN_THRESHOLD && (
            <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${atLimit ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
              <AlertTriangle size={14} />
              {atLimit ? 'Daily limit reached (500/500). Emails will fail.' : `${remaining} emails remaining today.`}
            </div>
          )}

          {/* Recipient */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Recipient</label>
            <div className="flex gap-2 mb-2">
              {(['contact', 'manual'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-3 py-1.5 text-xs rounded-lg border ${mode === m ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                  {m === 'contact' ? 'From Contacts' : 'Manual Entry'}
                </button>
              ))}
            </div>
            {mode === 'contact' ? (
              <select value={contactId} onChange={(e) => setContactId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select a contact…</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.email}</option>)}
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Name"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="email" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="Email *"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            )}
          </div>

          {/* Template */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Template (optional)</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">No template — compose manually</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {/* Placeholder buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Insert:</span>
            {PLACEHOLDERS.map((ph) => (
              <button key={ph} type="button" onClick={() => insertPh(ph)}
                className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-mono">
                {ph}
              </button>
            ))}
            <span className="text-xs text-gray-400 ml-1">(into focused field)</span>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Subject *</label>
            <input
              ref={subjectRef}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onFocus={() => setLastFocus('subject')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Email subject"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Body *</label>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onFocus={() => setLastFocus('body')}
              rows={7}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-y"
              placeholder="Email body…"
            />
          </div>

          {/* Schedule */}
          <div className="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
            <input type="checkbox" id="schedule" checked={scheduleMode} onChange={(e) => setScheduleMode(e.target.checked)} className="mt-0.5" />
            <div className="flex-1">
              <label htmlFor="schedule" className="text-sm font-medium text-gray-700 cursor-pointer">Schedule for later</label>
              {scheduleMode && (
                <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              )}
            </div>
          </div>

          {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => setShowPreview(true)}
            disabled={!subject && !body}
            className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            <Eye size={13} /> Preview
          </button>
          <button onClick={send} disabled={sending || atLimit}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {sending ? 'Sending…' : scheduleMode ? <><Clock size={13} /> Schedule</> : <><Send size={13} /> Send Now</>}
          </button>
        </div>
      </div>
    </div>
  )
}
