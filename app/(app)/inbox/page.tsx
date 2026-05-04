'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { InboxMessage, EmailHistory } from '@/lib/types'
import { formatDateTime } from '@/lib/utils'
import { RefreshCw, Send, Inbox, CheckCircle, XCircle, Ban, Sparkles, ChevronRight } from 'lucide-react'
import Link from 'next/link'

type Filter = 'all' | 'unread' | 'interested' | 'not_interested'

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const [messages, setMessages] = useState<InboxMessage[]>([])
  const [selected, setSelected] = useState<InboxMessage | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)

  const load = useCallback(async (showSyncing = false) => {
    if (showSyncing) setSyncing(true)
    try {
      const res = await fetch('/api/gmail/inbox')
      if (res.ok) {
        const data = await res.json() as { messages: InboxMessage[] }
        setMessages(data.messages)
        setLastSynced(new Date())
      }
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(() => load(), 60_000)
    return () => clearInterval(interval)
  }, [load])

  const filtered = messages.filter(m => {
    if (filter === 'unread') return !m.is_read
    if (filter === 'interested') return m.contacts?.status === 'interested'
    if (filter === 'not_interested') return m.contacts?.status === 'not_interested'
    return true
  })

  const unreadCount = messages.filter(m => !m.is_read).length

  function onSelect(msg: InboxMessage) {
    setSelected(msg)
    // Mark read locally immediately
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_read: true } : m))
    // Persist to server
    fetch(`/api/gmail/inbox/${msg.id}/read`, { method: 'POST' }).catch(() => null)
  }

  function onContactUpdate(msgId: string, status: string) {
    setMessages(prev => prev.map(m =>
      m.id === msgId ? { ...m, contacts: m.contacts ? { ...m.contacts, status } : m.contacts } : m
    ))
    if (selected?.id === msgId && selected.contacts) {
      setSelected(s => s ? { ...s, contacts: { ...s.contacts!, status } } : s)
    }
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
    { key: 'interested', label: 'Interested' },
    { key: 'not_interested', label: 'Not Interested' },
  ]

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-8 overflow-hidden">
      {/* ── Left pane: message list ──────────────────────────────────── */}
      <div className="w-96 flex flex-col border-r border-gray-200 bg-white shrink-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Inbox size={16} className="text-blue-600" />
            <span className="font-semibold text-gray-900 text-sm">Inbox</span>
            {unreadCount > 0 && (
              <span className="bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <button
            onClick={() => load(true)}
            disabled={syncing}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
          >
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            {lastSynced ? timeAgo(lastSynced.toISOString()) : 'Sync'}
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex border-b border-gray-100 px-2 pt-2 gap-1">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1.5 text-xs rounded-t font-medium transition-colors ${
                filter === f.key
                  ? 'bg-white border border-b-0 border-gray-200 text-blue-700'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center py-12 text-gray-400 text-sm">Loading inbox…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              {filter === 'all' ? 'No replies from contacts yet.' : `No ${filter.replace('_', ' ')} replies.`}
            </div>
          ) : (
            filtered.map(msg => (
              <MessageRow
                key={msg.id}
                msg={msg}
                selected={selected?.id === msg.id}
                onClick={() => onSelect(msg)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right pane: conversation ────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
        {selected ? (
          <ConversationPane
            msg={selected}
            onContactUpdate={(status) => onContactUpdate(selected.id, status)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <Inbox size={40} className="mb-3 opacity-30" />
            <p className="text-sm">Select a message to read</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Message row ────────────────────────────────────────────────────────────────

function MessageRow({ msg, selected, onClick }: {
  msg: InboxMessage
  selected: boolean
  onClick: () => void
}) {
  const statusColor: Record<string, string> = {
    interested: 'bg-green-100 text-green-700',
    not_interested: 'bg-red-100 text-red-700',
    responded: 'bg-blue-100 text-blue-700',
    new: 'bg-gray-100 text-gray-600',
  }
  const status = msg.contacts?.status ?? ''

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-blue-50 transition-colors ${
        selected ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {!msg.is_read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
            <span className={`text-sm font-medium text-gray-900 truncate ${!msg.is_read ? 'font-semibold' : ''}`}>
              {msg.contacts?.name ?? msg.from_name ?? msg.from_email}
            </span>
          </div>
          <p className="text-xs text-gray-500 truncate mt-0.5">{msg.subject}</p>
          <p className="text-xs text-gray-400 truncate mt-0.5">{msg.body_preview}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-xs text-gray-400">{timeAgo(msg.received_at)}</span>
          {status && statusColor[status] && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium capitalize ${statusColor[status]}`}>
              {status.replace('_', ' ')}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ── Conversation pane ──────────────────────────────────────────────────────────

function ConversationPane({ msg, onContactUpdate }: {
  msg: InboxMessage
  onContactUpdate: (status: string) => void
}) {
  const [sentEmails, setSentEmails] = useState<Pick<EmailHistory, 'id' | 'subject' | 'body' | 'sent_at' | 'created_at' | 'status'>[]>([])
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendOk, setSendOk] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [classification, setClassification] = useState<{ classification: string; reason: string } | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const supabase = createClient()
  const replyRef = useRef<HTMLTextAreaElement>(null)

  // Load emails sent to this contact
  useEffect(() => {
    setSentEmails([])
    setClassification(null)
    setSendOk(false)
    setSendError('')
    setReplyBody('')
    if (!msg.contact_id) return
    supabase
      .from('email_history')
      .select('id, subject, body, sent_at, created_at, status')
      .eq('contact_id', msg.contact_id)
      .eq('status', 'sent')
      .order('sent_at', { ascending: true })
      .limit(10)
      .then(({ data }) => setSentEmails(data ?? []))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.id])

  async function updateContactStatus(status: string) {
    if (!msg.contact_id) return
    setUpdatingStatus(true)
    const isDnc = status === 'do_not_contact'
    if (isDnc) {
      await supabase.from('contacts').update({ do_not_contact: true }).eq('id', msg.contact_id)
      onContactUpdate('inactive')
    } else {
      await supabase.from('contacts').update({ status }).eq('id', msg.contact_id)
      onContactUpdate(status)
    }
    setUpdatingStatus(false)
  }

  async function classify() {
    setClassifying(true)
    setClassification(null)
    const res = await fetch(`/api/gmail/inbox/${msg.id}/classify`, { method: 'POST' })
    const data = await res.json() as { classification?: string; reason?: string; error?: string }
    if (res.ok && data.classification) {
      setClassification({ classification: data.classification, reason: data.reason ?? '' })
    }
    setClassifying(false)
  }

  async function sendReply() {
    if (!replyBody.trim()) return
    setSending(true)
    setSendError('')
    setSendOk(false)
    const res = await fetch('/api/gmail/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inboxMessageId: msg.id, body: replyBody }),
    })
    const data = await res.json() as { ok?: boolean; error?: string }
    if (res.ok) {
      setSendOk(true)
      setReplyBody('')
    } else {
      setSendError(data.error ?? 'Failed to send')
    }
    setSending(false)
  }

  const classificationColors: Record<string, string> = {
    interested: 'bg-green-50 border-green-200 text-green-800',
    not_interested: 'bg-red-50 border-red-200 text-red-800',
    needs_more_info: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900 truncate">
                {msg.contacts?.name ?? msg.from_name ?? msg.from_email}
              </h2>
              {msg.contact_id && (
                <Link
                  href={`/contacts/${msg.contact_id}`}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                >
                  View Contact <ChevronRight size={10} />
                </Link>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{msg.from_email}</p>
            <p className="text-sm text-gray-700 mt-1 font-medium">{msg.subject}</p>
          </div>
          <span className="text-xs text-gray-400 shrink-0">{formatDateTime(msg.received_at)}</span>
        </div>

        {/* Quick action buttons */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button
            onClick={() => updateContactStatus('interested')}
            disabled={updatingStatus}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50"
          >
            <CheckCircle size={12} /> Interested
          </button>
          <button
            onClick={() => updateContactStatus('not_interested')}
            disabled={updatingStatus}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
          >
            <XCircle size={12} /> Not Interested
          </button>
          <button
            onClick={() => updateContactStatus('do_not_contact')}
            disabled={updatingStatus}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-50 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50"
          >
            <Ban size={12} /> Add to DNC
          </button>
          <button
            onClick={classify}
            disabled={classifying}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 disabled:opacity-50"
          >
            <Sparkles size={12} className={classifying ? 'animate-pulse' : ''} />
            {classifying ? 'Classifying…' : 'AI Classify'}
          </button>
        </div>

        {/* AI classification result */}
        {classification && (
          <div className={`mt-3 px-3 py-2 rounded-lg border text-xs ${classificationColors[classification.classification] ?? 'bg-gray-50 border-gray-200 text-gray-700'}`}>
            <span className="font-semibold capitalize">{classification.classification.replace('_', ' ')}</span>
            {' — '}{classification.reason}
          </div>
        )}
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {/* Previous sent emails */}
        {sentEmails.map(e => (
          <div key={e.id} className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-blue-700">You sent</span>
              <span className="text-xs text-blue-400">{formatDateTime(e.sent_at ?? e.created_at)}</span>
            </div>
            <p className="text-xs font-medium text-blue-900 mb-1">{e.subject}</p>
            <p className="text-sm text-blue-800 whitespace-pre-wrap">{e.body}</p>
          </div>
        ))}

        {/* Their reply */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-700">
              {msg.contacts?.name ?? msg.from_name ?? msg.from_email} replied
            </span>
            <span className="text-xs text-gray-400">{formatDateTime(msg.received_at)}</span>
          </div>
          <p className="text-sm text-gray-900 whitespace-pre-wrap">{msg.body_full ?? msg.body_preview}</p>
        </div>
      </div>

      {/* Reply composer */}
      <div className="bg-white border-t border-gray-200 px-6 py-4">
        {sendOk && (
          <p className="text-xs text-green-600 font-medium mb-2 flex items-center gap-1">
            <CheckCircle size={12} /> Reply sent successfully.
          </p>
        )}
        {sendError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">{sendError}</p>
        )}
        <textarea
          ref={replyRef}
          value={replyBody}
          onChange={e => setReplyBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) sendReply() }}
          placeholder="Write a reply… (Cmd+Enter to send)"
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={sendReply}
            disabled={sending || !replyBody.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Send size={13} />
            {sending ? 'Sending…' : 'Send Reply'}
          </button>
        </div>
      </div>
    </div>
  )
}
