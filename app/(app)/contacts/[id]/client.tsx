'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Contact, ContactNote, ContactStatus } from '@/lib/types'
import { formatDateTime, STATUS_COLORS } from '@/lib/utils'
import Link from 'next/link'

const ALL_STATUSES: ContactStatus[] = [
  'new', 'prospect', 'active', 'inactive', 'customer', 'responded', 'interested', 'not_interested',
]

// ── Main export ───────────────────────────────────────────────────────────────
export default function ContactDetailClient({
  contact: initial,
  notes: initialNotes,
  emails,
}: {
  contact: Contact
  notes: ContactNote[]
  emails: { id: string; subject: string; status: string; sent_at: string | null; created_at: string }[]
}) {
  const router = useRouter()
  const [contact, setContact] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: initial.name,
    email: initial.email,
    address: initial.address ?? '',
    phone: initial.phone ?? '',
    company: initial.company ?? '',
    status: initial.status,
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const supabase = createClient()

  function startEdit() {
    setForm({
      name: contact.name,
      email: contact.email,
      address: contact.address ?? '',
      phone: contact.phone ?? '',
      company: contact.company ?? '',
      status: contact.status,
    })
    setSaveError('')
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setSaveError('')
  }

  async function save() {
    if (!form.name.trim() || !form.email.trim()) {
      setSaveError('Name and email are required.')
      return
    }
    setSaving(true)
    setSaveError('')

    const updates = {
      name: form.name.trim(),
      email: form.email.trim(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      company: form.company.trim() || null,
      status: form.status,
    }

    const { data, error } = await supabase
      .from('contacts')
      .update(updates)
      .eq('id', contact.id)
      .select()
      .single()

    if (error) {
      setSaveError(error.message)
      setSaving(false)
      return
    }

    setContact(data as Contact)
    setEditing(false)
    setSaving(false)
    router.refresh()
  }

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link href="/contacts" className="text-sm text-gray-500 hover:text-gray-700">← Contacts</Link>

        <div className="flex items-start justify-between mt-2 gap-4">
          {editing ? (
            <div className="flex-1 space-y-2">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Name"
                className="text-2xl font-bold text-gray-900 border-b-2 border-blue-400 bg-transparent w-full focus:outline-none py-0.5"
              />
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Email"
                type="email"
                className="text-sm text-gray-600 border-b border-gray-300 bg-transparent w-full focus:outline-none py-0.5 focus:border-blue-400"
              />
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{contact.name}</h1>
              <p className="text-gray-500 text-sm mt-0.5">{contact.email}</p>
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0 mt-1">
            {contact.do_not_contact && (
              <span className="px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded-full">Do Not Contact</span>
            )}
            {editing ? (
              <>
                <button
                  onClick={cancelEdit}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 font-medium"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button
                onClick={startEdit}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {saveError && (
          <p className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>
        )}
      </div>

      {/* ── Body grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact info panel */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Contact Info</h2>

          {editing ? (
            <div className="space-y-3 text-sm">
              {([
                ['Company', 'company', 'text'],
                ['Phone', 'phone', 'tel'],
                ['Address', 'address', 'text'],
              ] as [string, keyof typeof form, string][]).map(([label, key, type]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-400 mb-1">{label}</label>
                  <input
                    type={type}
                    value={form[key] as string}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    placeholder={`Enter ${label.toLowerCase()}`}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as ContactStatus })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <dl className="space-y-3 text-sm">
              {[
                ['Company', contact.company],
                ['Phone', contact.phone],
                ['Address', contact.address],
                ['Added', formatDateTime(contact.created_at)],
              ].map(([label, value]) => value && (
                <div key={label as string}>
                  <dt className="text-gray-400 text-xs">{label}</dt>
                  <dd className="text-gray-900 mt-0.5">{value}</dd>
                </div>
              ))}
              <div>
                <dt className="text-gray-400 text-xs mb-1">Status</dt>
                <dd>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[contact.status] ?? 'bg-gray-100 text-gray-700'}`}>
                    {contact.status.replace(/_/g, ' ')}
                  </span>
                </dd>
              </div>
              {(contact.tags?.length ?? 0) > 0 && (
                <div>
                  <dt className="text-gray-400 text-xs">Tags</dt>
                  <dd className="flex flex-wrap gap-1 mt-1">
                    {contact.tags!.map((t) => (
                      <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">{t}</span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>

        {/* Notes + email history */}
        <div className="lg:col-span-2 space-y-6">
          <NotesPanel contactId={contact.id} initialNotes={initialNotes} />

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Email History ({emails.length})</h2>
            {emails.length === 0 ? (
              <p className="text-sm text-gray-400">No emails sent to this contact yet.</p>
            ) : (
              <div className="space-y-3">
                {emails.map((e) => (
                  <div key={e.id} className="border border-gray-100 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">{e.subject}</span>
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

// ── Notes panel (unchanged logic, moved here) ─────────────────────────────────
function NotesPanel({ contactId, initialNotes }: { contactId: string; initialNotes: ContactNote[] }) {
  const [notes, setNotes] = useState(initialNotes)
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  async function addNote() {
    if (!newNote.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase
      .from('contact_notes')
      .insert({ contact_id: contactId, user_id: user!.id, content: newNote.trim() })
      .select()
      .single()
    if (data) setNotes([data, ...notes])
    setNewNote('')
    setSaving(false)
  }

  async function deleteNote(id: string) {
    await supabase.from('contact_notes').delete().eq('id', id)
    setNotes(notes.filter((n) => n.id !== id))
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-4">Notes</h2>
      <div className="flex gap-2 mb-4">
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) addNote() }}
          placeholder="Add a note… (Cmd+Enter to save)"
          rows={2}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <button
          onClick={addNote}
          disabled={saving || !newNote.trim()}
          className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60 self-end"
        >
          Add
        </button>
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-gray-400">No notes yet.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div key={note.id} className="flex items-start justify-between gap-2 bg-gray-50 rounded-lg p-3">
              <div>
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{note.content}</p>
                <p className="text-xs text-gray-400 mt-1">{formatDateTime(note.created_at)}</p>
              </div>
              <button onClick={() => deleteNote(note.id)} className="text-gray-300 hover:text-red-500 text-xs shrink-0">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
