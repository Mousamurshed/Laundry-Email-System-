'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { EmailTemplate } from '@/lib/types'
import { formatDate, replacePlaceholders, insertAtCursor } from '@/lib/utils'
import { Plus } from 'lucide-react'

const PLACEHOLDERS = ['{{name}}', '{{email}}', '{{company}}', '{{address}}', '{{phone}}']

const SAMPLE_DATA: Record<string, string> = {
  name: 'Jane Smith', email: 'jane@example.com',
  company: 'Acme Corp', address: '123 Main St', phone: '(555) 000-0000',
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<EmailTemplate | null>(null)
  const [previewing, setPreviewing] = useState<EmailTemplate | null>(null)
  const supabase = createClient()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('email_templates').select('*').eq('user_id', user!.id).order('created_at', { ascending: false })
    setTemplates(data ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this template?')) return
    await supabase.from('email_templates').delete().eq('id', id)
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Email Templates</h1>
          <p className="text-xs text-gray-400 mt-0.5">Use {PLACEHOLDERS.join(', ')} as placeholders</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true) }} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <Plus size={14} /> New Template
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          No templates yet. <button onClick={() => setShowForm(true)} className="text-blue-600 hover:underline">Create one</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 text-sm">{t.name}</h3>
                <p className="text-xs text-gray-500 mt-1 mb-3 font-medium">Subject: {t.subject}</p>
                <p className="text-xs text-gray-500 line-clamp-3 whitespace-pre-wrap">{t.body}</p>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">{formatDate(t.created_at)}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPreviewing(t)} className="text-xs text-gray-500 hover:text-gray-700">Preview</button>
                  <button onClick={() => { setEditing(t); setShowForm(true) }} className="text-xs text-blue-600 hover:text-blue-800">Edit</button>
                  <button onClick={() => deleteTemplate(t.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <TemplateFormModal
          template={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSave={() => { setShowForm(false); setEditing(null); load() }}
        />
      )}

      {previewing && <PreviewModal template={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  )
}

function TemplateFormModal({ template, onClose, onSave }: { template: EmailTemplate | null; onClose: () => void; onSave: () => void }) {
  const supabase = createClient()
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [form, setForm] = useState({ name: template?.name ?? '', subject: template?.subject ?? '', body: template?.body ?? '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  // Track which field was last focused to direct placeholder insertion
  const [lastFocus, setLastFocus] = useState<'subject' | 'body'>('body')

  function insertPlaceholder(ph: string) {
    if (lastFocus === 'subject' && subjectRef.current) {
      insertAtCursor(subjectRef.current, ph, (v) => setForm((f) => ({ ...f, subject: v })))
    } else if (bodyRef.current) {
      insertAtCursor(bodyRef.current, ph, (v) => setForm((f) => ({ ...f, body: v })))
    }
  }

  async function save() {
    if (!form.name || !form.subject || !form.body) { setError('All fields are required.'); return }
    setSaving(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    const payload = { ...form, user_id: user!.id }
    const { error } = template
      ? await supabase.from('email_templates').update(payload).eq('id', template.id)
      : await supabase.from('email_templates').insert(payload)
    if (error) { setError(error.message); setSaving(false) } else onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">{template ? 'Edit Template' : 'New Template'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Template Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Initial Outreach"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Placeholder buttons — insert into whichever field is focused */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-gray-600">Insert placeholder into focused field:</span>
              {PLACEHOLDERS.map((ph) => (
                <button key={ph} type="button" onClick={() => insertPlaceholder(ph)}
                  className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-mono">
                  {ph}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Subject Line</label>
            <input
              ref={subjectRef}
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              onFocus={() => setLastFocus('subject')}
              placeholder="e.g. Professional Laundry Service for {{company}}"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email Body</label>
            <textarea
              ref={bodyRef}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              onFocus={() => setLastFocus('body')}
              rows={10}
              placeholder={"Hi {{name}},\n\nI wanted to reach out about our professional laundry service…"}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-y"
            />
          </div>

          {form.body && (
            <div>
              <button type="button" onClick={() => setShowPreview(!showPreview)} className="text-xs text-blue-600 hover:underline">
                {showPreview ? 'Hide' : 'Show'} preview with sample data
              </button>
              {showPreview && (
                <div className="mt-2 border border-gray-200 rounded-lg p-4 bg-gray-50 text-sm text-gray-900 whitespace-pre-wrap">
                  <p className="text-xs text-gray-400 mb-2 font-medium">Subject: {replacePlaceholders(form.subject, SAMPLE_DATA)}</p>
                  <hr className="border-gray-200 mb-2" />
                  {replacePlaceholders(form.body, SAMPLE_DATA)}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PreviewModal({ template, onClose }: { template: EmailTemplate; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Preview: {template.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="p-5">
          <p className="text-xs text-gray-400 mb-1">Subject</p>
          <p className="text-sm font-medium text-gray-900 mb-4">{replacePlaceholders(template.subject, SAMPLE_DATA)}</p>
          <hr className="border-gray-100 mb-4" />
          <p className="text-sm text-gray-900 whitespace-pre-wrap">{replacePlaceholders(template.body, SAMPLE_DATA)}</p>
          <p className="text-xs text-gray-400 mt-4">Sample: {Object.entries(SAMPLE_DATA).map(([k, v]) => `${k}="${v}"`).join(', ')}</p>
        </div>
      </div>
    </div>
  )
}
