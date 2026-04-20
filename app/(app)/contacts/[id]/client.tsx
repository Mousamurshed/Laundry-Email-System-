'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ContactNote } from '@/lib/types'
import { formatDateTime } from '@/lib/utils'

export default function ContactDetailClient({
  contactId,
  initialNotes,
}: {
  contactId: string
  initialNotes: ContactNote[]
}) {
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
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</p>
                <p className="text-xs text-gray-400 mt-1">{formatDateTime(note.created_at)}</p>
              </div>
              <button
                onClick={() => deleteNote(note.id)}
                className="text-gray-300 hover:text-red-500 text-xs shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
