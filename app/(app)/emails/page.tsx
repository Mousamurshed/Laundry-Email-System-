'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Contact, EmailTemplate, EmailHistory } from '@/lib/types'
import { formatDateTime, replacePlaceholders, STATUS_COLORS, insertAtCursor } from '@/lib/utils'
import { Send, Clock, AlertTriangle, Eye, Users, WifiOff } from 'lucide-react'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isValidEmail(email: string | null | undefined): boolean {
  return !!email && EMAIL_RE.test(email.trim())
}

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
  const [showBulk, setShowBulk] = useState(false)
  const [gmailDisconnected, setGmailDisconnected] = useState(false)
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
        <div className="flex gap-2">
          <button onClick={() => setShowBulk(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
            <Users size={14} /> Bulk Send
          </button>
          <button onClick={() => setShowCompose(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Send size={14} /> Compose Email
          </button>
        </div>
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

      {/* Gmail reconnect banner */}
      {gmailDisconnected && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-6">
          <div className="flex items-center gap-2 text-sm text-red-700">
            <WifiOff size={15} />
            <span>Gmail token expired — reconnect to continue sending.</span>
          </div>
          <a href="/api/gmail/auth" className="shrink-0 px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">
            Reconnect Gmail
          </a>
        </div>
      )}

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
          onGmailError={() => { setShowCompose(false); setGmailDisconnected(true) }}
        />
      )}

      {showBulk && (
        <BulkSendModal
          contacts={contacts}
          templates={templates}
          sentToday={sentToday}
          onClose={() => { setShowBulk(false); load() }}
          onGmailError={() => { setShowBulk(false); setGmailDisconnected(true) }}
        />
      )}
    </div>
  )
}

// ── Compose Modal ─────────────────────────────────────────────────────────────
function ComposeModal({ contacts, templates, sentToday, onClose, onSent, onGmailError }: {
  contacts: Contact[]; templates: EmailTemplate[]; sentToday: number
  onClose: () => void; onSent: () => void; onGmailError: () => void
}) {
  const [mode, setMode] = useState<'contact' | 'manual'>('contact')
  const [contactId, setContactId] = useState('')
  const [manualEmail, setManualEmail] = useState('')
  const [manualName, setManualName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
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
        scheduleAt: null,
      }),
    })
    const json = await res.json()
    if (!res.ok) {
      if (json.error === 'gmail_reconnect_required') { onGmailError(); return }
      setError(json.error ?? 'Failed to send'); setSending(false)
    } else onSent()
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
          </div>
          <div className="flex justify-between gap-2 p-5 border-t border-gray-100">
            <button onClick={() => setShowPreview(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">← Back to Edit</button>
            <button onClick={send} disabled={sending || atLimit}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {sending ? 'Sending…' : <><Send size={13} /> Send Now</>}
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
            {sending ? 'Sending…' : <><Send size={13} /> Send Now</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Bulk Send Modal ───────────────────────────────────────────────────────────

const RATE_OPTIONS = [
  { label: '1 per minute (best deliverability)', value: 1, delayMs: 60_000 },
  { label: '2 per minute', value: 2, delayMs: 30_000 },
  { label: '5 per minute', value: 5, delayMs: 12_000 },
  { label: '10 per minute', value: 10, delayMs: 6_000 },
]

const ALL_STATUSES = ['new', 'prospect', 'active', 'inactive', 'customer', 'responded', 'interested', 'not_interested']

type BulkPhase = 'config' | 'sending' | 'done'

function BulkSendModal({ contacts, templates, sentToday, onClose, onGmailError }: {
  contacts: Contact[]
  templates: EmailTemplate[]
  sentToday: number
  onClose: () => void
  onGmailError: () => void
}) {
  // ── Config state ──────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<BulkPhase>('config')
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [subject, setSubject] = useState(templates[0]?.subject ?? '')
  const [body, setBody] = useState(templates[0]?.body ?? '')
  const [filterMode, setFilterMode] = useState<'all' | 'status' | 'select'>('all')
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set(['new']))
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set())
  const [selectSearch, setSelectSearch] = useState('')
  const [rateIdx, setRateIdx] = useState(0) // default: 1/min

  // ── Schedule state ────────────────────────────────────────────────────────
  // ── Progress state ────────────────────────────────────────────────────────
  const [sentCount, setSentCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [currentContact, setCurrentContact] = useState<Contact | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  // Refs so async loop always sees latest values
  const pausedRef = useRef(false)
  const cancelledRef = useRef(false)

  const rate = RATE_OPTIONS[rateIdx]

  // Confirmed contacts are always excluded from bulk sends (like DNC)
  const confirmedSkipped = contacts.filter(c => c.status === 'confirmed').length

  // Contacts that will receive the email
  const recipients = contacts.filter((c) => {
    if (c.do_not_contact) return false
    if (c.status === 'confirmed') return false   // never send bulk email to confirmed contacts
    if (filterMode === 'status') return selectedStatuses.has(c.status)
    if (filterMode === 'select') return selectedContactIds.has(c.id)
    return true
  })
  const validRecipients = recipients.filter(c => isValidEmail(c.email))
  const invalidEmailCount = recipients.length - validRecipients.length

  const selectableContacts = contacts.filter((c) => !c.do_not_contact && c.status !== 'confirmed')
  const filteredSelectable = selectableContacts.filter((c) => {
    if (!selectSearch.trim()) return true
    const q = selectSearch.toLowerCase()
    return c.name.toLowerCase().includes(q) || (c.address ?? '').toLowerCase().includes(q)
  })

  function toggleContact(id: string) {
    const next = new Set(selectedContactIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelectedContactIds(next)
  }

  function selectAll() {
    setSelectedContactIds(new Set(filteredSelectable.map((c) => c.id)))
  }

  function deselectAll() {
    setSelectedContactIds(new Set())
  }

  const remaining = validRecipients.length - sentCount - failedCount

  function fmtEta(seconds: number) {
    if (seconds < 60) return `${Math.ceil(seconds)}s`
    const m = Math.floor(seconds / 60)
    const s = Math.ceil(seconds % 60)
    return s > 0 ? `${m}m ${s}s` : `${m}m`
  }

  function toggleStatus(s: string) {
    const next = new Set(selectedStatuses)
    if (next.has(s)) next.delete(s); else next.add(s)
    setSelectedStatuses(next)
  }

  // Sync subject/body when template changes
  function selectTemplate(id: string) {
    setTemplateId(id)
    const t = templates.find((t) => t.id === id)
    if (t) { setSubject(t.subject); setBody(t.body) }
  }

  function pause() { pausedRef.current = true; setIsPaused(true) }
  function resume() { pausedRef.current = false; setIsPaused(false) }
  function cancel() { cancelledRef.current = true; pausedRef.current = false }

  async function waitWithPause(totalMs: number) {
    const tick = 250
    let elapsed = 0
    while (elapsed < totalMs) {
      if (cancelledRef.current) return
      await new Promise((r) => setTimeout(r, tick))
      if (!pausedRef.current) elapsed += tick
    }
  }

  async function startSend() {
    if (!subject || !body || validRecipients.length === 0) return
    setSentCount(0); setFailedCount(0); setErrors([])
    cancelledRef.current = false; pausedRef.current = false
    setIsPaused(false)
    setPhase('sending')

    let sent = 0; let failed = 0
    const errs: string[] = []

    for (let i = 0; i < validRecipients.length; i++) {
      if (cancelledRef.current) break

      // Wait while paused
      while (pausedRef.current && !cancelledRef.current) {
        await new Promise((r) => setTimeout(r, 250))
      }
      if (cancelledRef.current) break

      const contact = validRecipients[i]
      setCurrentContact(contact)

      const data = {
        name: contact.name, email: contact.email,
        company: contact.company ?? '', address: contact.address ?? '',
        phone: contact.phone ?? '',
      }

      try {
        const res = await fetch('/api/emails/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId: contact.id,
            templateId: templateId || null,
            toEmail: contact.email,
            toName: contact.name,
            subject: replacePlaceholders(subject, data),
            body: replacePlaceholders(body, data),
            scheduleAt: null,
          }),
        })
        if (res.ok) { sent++ } else {
          const json = await res.json().catch(() => ({}))
          if (json.error === 'gmail_reconnect_required') { onGmailError(); return }
          failed++
          errs.push(`${contact.email}: ${json.error ?? 'failed'}`)
        }
      } catch {
        failed++
        errs.push(`${contact.email}: network error`)
      }

      setSentCount(sent)
      setFailedCount(failed)
      setErrors([...errs])

      // Rate-limit delay between sends (supports pause)
      if (i < validRecipients.length - 1) {
        await waitWithPause(rate.delayMs)
      }
    }

    setCurrentContact(null)
    setPhase('done')
  }

  const pct = validRecipients.length > 0 ? ((sentCount + failedCount) / validRecipients.length) * 100 : 0
  const atLimit = sentToday >= DAILY_LIMIT

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-blue-600" />
            <h2 className="font-semibold text-gray-900">Bulk Send</h2>
            {phase === 'sending' && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isPaused ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700 animate-pulse'}`}>
                {isPaused ? 'Paused' : 'Sending…'}
              </span>
            )}
          </div>
          {phase !== 'sending' && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
          )}
        </div>

        {/* ── PHASE: CONFIG ──────────────────────────────────────────────── */}
        {phase === 'config' && (
          <>
            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              {atLimit && (
                <div className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200">
                  <AlertTriangle size={14} /> Daily limit reached (500/500). Sending will fail.
                </div>
              )}

              {/* Template */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Template</label>
                <select value={templateId} onChange={(e) => selectTemplate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Select template —</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              {/* Subject / body (read-only preview if template selected) */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                <input value={subject} onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject line (placeholders supported)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Body</label>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
                  placeholder="Email body…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-y" />
              </div>

              {/* Recipients */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Recipients</label>
                <div className="flex gap-2 mb-3 flex-wrap">
                  {([
                    ['all', 'All contacts'],
                    ['status', 'Filter by status'],
                    ['select', 'Select contacts'],
                  ] as const).map(([m, label]) => (
                    <button key={m} onClick={() => setFilterMode(m)}
                      className={`px-3 py-1.5 text-xs rounded-lg border ${filterMode === m ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {filterMode === 'status' && (
                  <div className="flex flex-wrap gap-2">
                    {ALL_STATUSES.map((s) => (
                      <label key={s} className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input type="checkbox" checked={selectedStatuses.has(s)}
                          onChange={() => toggleStatus(s)} className="rounded" />
                        <span className="text-xs text-gray-700 capitalize">{s.replace(/_/g, ' ')}</span>
                      </label>
                    ))}
                  </div>
                )}
                {filterMode === 'select' && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="text"
                        value={selectSearch}
                        onChange={(e) => setSelectSearch(e.target.value)}
                        placeholder="Search by name or address…"
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button onClick={selectAll} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 whitespace-nowrap">
                        Select all
                      </button>
                      <button onClick={deselectAll} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 whitespace-nowrap">
                        Deselect all
                      </button>
                    </div>
                    <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                      {filteredSelectable.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-4">No contacts found.</p>
                      ) : (
                        filteredSelectable.map((c) => (
                          <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0">
                            <input
                              type="checkbox"
                              checked={selectedContactIds.has(c.id)}
                              onChange={() => toggleContact(c.id)}
                              className="rounded shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-900 truncate">{c.name}</p>
                              {c.address && <p className="text-xs text-gray-400 truncate">{c.address}</p>}
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                    <p className="text-xs text-blue-600 font-medium mt-1.5">
                      {selectedContactIds.size} selected
                    </p>
                  </div>
                )}
                <p className={`mt-3 text-sm font-medium ${validRecipients.length === 0 ? 'text-red-500' : 'text-gray-700'}`}>
                  {validRecipients.length === 0
                    ? 'No contacts match — adjust filters.'
                    : `Will send to ${validRecipients.length} contact${validRecipients.length === 1 ? '' : 's'} (DNC excluded)`}
                  {confirmedSkipped > 0 && (
                    <span className="block text-xs text-green-700 mt-0.5">
                      {confirmedSkipped} confirmed contact{confirmedSkipped === 1 ? '' : 's'} will be skipped automatically.
                    </span>
                  )}
                  {invalidEmailCount > 0 && (
                    <span className="block text-xs text-amber-700 mt-0.5">
                      ⚠ {invalidEmailCount} contact{invalidEmailCount === 1 ? '' : 's'} skipped — missing or invalid email address.
                    </span>
                  )}
                </p>
              </div>

              {/* Rate */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Sending Rate</label>
                <div className="space-y-2">
                  {RATE_OPTIONS.map((opt, i) => (
                    <label key={i} className="flex items-center gap-2.5 cursor-pointer">
                      <input type="radio" name="rate" checked={rateIdx === i} onChange={() => setRateIdx(i)} />
                      <span className="text-sm text-gray-700">{opt.label}</span>
                      {i === 0 && <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">recommended</span>}
                    </label>
                  ))}
                </div>
                {validRecipients.length > 0 && (
                  <p className="text-xs text-gray-400 mt-2">
                    ETA: ~{fmtEta(validRecipients.length * (rate.delayMs / 1000))} total
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-gray-200">
              <div className="flex items-center justify-between p-5">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={startSend}
                  disabled={!subject || !body || validRecipients.length === 0 || atLimit}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  <Send size={13} /> Start Bulk Send ({validRecipients.length})
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── PHASE: SENDING ─────────────────────────────────────────────── */}
        {phase === 'sending' && (
          <div className="p-6 space-y-5">
            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium text-gray-900">
                  {sentCount + failedCount} of {validRecipients.length} processed
                </span>
                <span className="text-gray-500">
                  {isPaused ? 'Paused' : `~${fmtEta(remaining * (rate.delayMs / 1000))} remaining`}
                </span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${isPaused ? 'bg-amber-400' : 'bg-blue-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-green-50 border border-green-100 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-700">{sentCount}</div>
                <div className="text-xs text-green-600 mt-0.5">Sent</div>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-gray-700">{remaining > 0 ? remaining : 0}</div>
                <div className="text-xs text-gray-500 mt-0.5">Remaining</div>
              </div>
              <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-600">{failedCount}</div>
                <div className="text-xs text-red-500 mt-0.5">Failed</div>
              </div>
            </div>

            {/* Current contact */}
            {currentContact && (
              <div className="flex items-center gap-2 text-sm text-gray-600 bg-blue-50 rounded-lg px-4 py-3">
                <div className={`w-2 h-2 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-blue-500 animate-pulse'}`} />
                {isPaused ? 'Paused before: ' : 'Sending to: '}
                <span className="font-medium text-gray-900">{currentContact.name}</span>
                <span className="text-gray-400">&lt;{currentContact.email}&gt;</span>
              </div>
            )}

            {/* Rate info */}
            <p className="text-xs text-gray-400 text-center">{rate.label}</p>

            {/* Recent errors */}
            {errors.length > 0 && (
              <div className="border border-red-200 bg-red-50 rounded-lg p-3 max-h-24 overflow-y-auto">
                <p className="text-xs font-medium text-red-700 mb-1">Errors ({errors.length})</p>
                {errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
              </div>
            )}

            {/* Controls */}
            <div className="flex justify-center gap-3 pt-2">
              {isPaused ? (
                <button onClick={resume}
                  className="flex items-center gap-1.5 px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  ▶ Resume
                </button>
              ) : (
                <button onClick={pause}
                  className="flex items-center gap-1.5 px-5 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600">
                  ⏸ Pause
                </button>
              )}
              <button onClick={cancel}
                className="px-5 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50">
                ✕ Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── PHASE: DONE ────────────────────────────────────────────────── */}
        {phase === 'done' && (
          <div className="p-6 text-center space-y-4">
            <div className="text-4xl">{failedCount === 0 ? '✅' : '⚠️'}</div>
            <h3 className="text-lg font-semibold text-gray-900">
              {cancelledRef.current ? 'Bulk send cancelled' : 'Bulk send complete'}
            </h3>
            <div className="flex justify-center gap-6 text-sm">
              <div><span className="text-2xl font-bold text-green-600">{sentCount}</span><br /><span className="text-gray-500">Sent</span></div>
              <div><span className="text-2xl font-bold text-red-500">{failedCount}</span><br /><span className="text-gray-500">Failed</span></div>
              <div><span className="text-2xl font-bold text-gray-400">{validRecipients.length - sentCount - failedCount}</span><br /><span className="text-gray-500">Skipped</span></div>
            </div>
            {errors.length > 0 && (
              <div className="text-left border border-red-200 bg-red-50 rounded-lg p-3 max-h-28 overflow-y-auto">
                <p className="text-xs font-medium text-red-700 mb-1">Failed addresses</p>
                {errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
              </div>
            )}
            <button onClick={onClose} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
