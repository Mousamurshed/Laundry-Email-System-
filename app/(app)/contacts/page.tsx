'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Contact, ContactStatus } from '@/lib/types'
import { exportToCSV, formatDate, STATUS_COLORS } from '@/lib/utils'
import Link from 'next/link'
import { Plus, Download, Search, Ban, Upload, Building2, List, CheckSquare, Trophy, Reply } from 'lucide-react'
import * as XLSX from 'xlsx'

const ALL_STATUSES: ContactStatus[] = ['new', 'prospect', 'active', 'inactive', 'customer', 'responded', 'interested', 'not_interested', 'confirmed']

// Column name aliases for CSV/Excel auto-detection
const COL_MAP: Record<string, string> = {
  name: 'name', full_name: 'name', fullname: 'name', contact: 'name',
  email: 'email', email_address: 'email', emailaddress: 'email',
  phone: 'phone', phone_number: 'phone', phonenumber: 'phone', telephone: 'phone', mobile: 'phone',
  address: 'address', street: 'address', street_address: 'address',
  unit: 'unit', apt: 'unit', apartment: 'unit', suite: 'unit', unit_number: 'unit',
  company: 'company', organization: 'company', business: 'company',
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-#]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

// Strip unit/apt identifiers to get the base building address.
// "137 East 38th #5H"  → "137 East 38th"
// "137 East 38th #12E" → "137 East 38th"
// "123 Main St, Apt 4B"  → "123 Main St"
// "456 Park Ave Unit 7"  → "456 Park Ave"
// "165  EAST  35TH"      → "165 East 35th"
function extractBuilding(address: string): string {
  const raw = address
    .trim()
    .replace(/\s+/g, ' ')                                    // collapse internal whitespace first
    .split(',')[0]                                           // drop everything after a comma
    .replace(/\s+#\s*[\w-]+$/, '')                          // strip " #5H" / " # 12E"
    .replace(/\s+(apt\.?|apartment|unit|suite|ste\.?|fl\.?|floor|rm\.?|room)\s+[\w-]+$/i, '')
    .trim()
  // Title-case: "EAST" → "East", "35TH" → "35th", "st" → "St"
  return raw.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

// Numeric part of a unit identifier for sorting (e.g. "#12E" → 12, "#5H" → 5)
function unitSortKey(address: string): number {
  const m = address.match(/#\s*(\d+)|(?:apt|unit|suite|floor)\s*(\d+)/i)
  return m ? parseInt(m[1] ?? m[2], 10) : 0
}

// Normalise a title-cased building label to a stable grouping key.
// Strips ordinal suffixes so "55th", "55Th", "55" all map to the same key.
// "160 East 55Th" → "160 east 55"
function normalizeForGrouping(building: string): string {
  return building
    .toLowerCase()
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

// Sort key for a building: strip leading house number so we sort by street name.
// "137 East 38th" → "east 38"
// "205 West 42nd" → "west 42"
function streetSortKey(building: string): string {
  return normalizeForGrouping(building).replace(/^\d+\s*/, '')
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [filtered, setFiltered] = useState<Contact[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dncOnly, setDncOnly] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'building'>('list')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [deleteSuccess, setDeleteSuccess] = useState('')
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const supabase = createClient()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
    setContacts(data ?? [])
    setSelected(new Set())
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let list = contacts
    if (dncOnly) list = list.filter((c) => c.do_not_contact)
    if (statusFilter !== 'all') list = list.filter((c) => c.status === statusFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.address?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q)
      )
    }
    setFiltered(list)
    setSelected(new Set())
  }, [contacts, search, statusFilter, dncOnly])

  // ── Bulk helpers ──────────────────────────────────────────────────────────
  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id))
  const someSelected = selected.size > 0

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(filtered.map((c) => c.id)))
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }

  async function bulkSetStatus(status: ContactStatus) {
    const ids = [...selected]
    await supabase.from('contacts').update({ status }).in('id', ids)
    load()
  }

  async function bulkSetDnc(value: boolean) {
    const ids = [...selected]
    await supabase.from('contacts').update({ do_not_contact: value }).in('id', ids)
    load()
  }

  async function bulkDelete() {
    const ids = [...selected]
    const count = ids.length
    await supabase.from('contacts').delete().in('id', ids)
    setConfirmDeleteOpen(false)
    setDeleteSuccess(`${count} contact${count === 1 ? '' : 's'} deleted.`)
    setTimeout(() => setDeleteSuccess(''), 4000)
    load()
  }

  // ── Single-row helpers ────────────────────────────────────────────────────
  async function toggleDnc(contact: Contact) {
    await supabase.from('contacts').update({ do_not_contact: !contact.do_not_contact }).eq('id', contact.id)
    load()
  }

  async function deleteContact(id: string) {
    if (!confirm('Delete this contact?')) return
    await supabase.from('contacts').delete().eq('id', id)
    load()
  }

  // ── Building grouping ─────────────────────────────────────────────────────
  const buildingGroups = (() => {
    // Key: normalized form (lowercase, no ordinals). Value: group data + display-name tally.
    const groups: Record<string, {
      contacts: Contact[]
      contacted: number
      displayNames: Record<string, number>
    }> = {}
    const noAddress: Contact[] = []

    for (const c of filtered) {
      if (!c.address) { noAddress.push(c); continue }
      const display = extractBuilding(c.address)       // title-cased
      const key = normalizeForGrouping(display)         // stable merge key

      if (!groups[key]) groups[key] = { contacts: [], contacted: 0, displayNames: {} }
      groups[key].contacts.push(c)
      groups[key].displayNames[display] = (groups[key].displayNames[display] ?? 0) + 1
      if (!['new', 'prospect', 'inactive'].includes(c.status)) groups[key].contacted++
    }

    // Sort contacts within each building by unit number
    for (const g of Object.values(groups)) {
      g.contacts.sort((a, b) =>
        unitSortKey(a.address ?? '') - unitSortKey(b.address ?? '') ||
        (a.address ?? '').localeCompare(b.address ?? ''))
    }

    // Resolve each group's display name as the most-seen variant
    const sorted: [string, { contacts: Contact[]; contacted: number }][] = Object.values(groups)
      .map(g => {
        const displayName = Object.entries(g.displayNames).sort((a, b) => b[1] - a[1])[0][0]
        return [displayName, { contacts: g.contacts, contacted: g.contacted }] as [string, { contacts: Contact[]; contacted: number }]
      })
      .sort(([a], [b]) => streetSortKey(a).localeCompare(streetSortKey(b)))

    return { sorted, noAddress }
  })()

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
          <p className="text-sm text-gray-500 mt-0.5">{contacts.length} total</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
            <Upload size={14} /> Import
          </button>
          <button onClick={() => exportToCSV(filtered.map(({ id: _id, user_id: _uid, ...c }) => c), 'contacts.csv')} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
            <Download size={14} /> Export
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true) }} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Plus size={14} /> Add Contact
          </button>
        </div>
      </div>

      {/* Quick-filter tabs */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {([
          { key: 'all',       label: 'All',         cls: 'bg-gray-100 text-gray-700 border-gray-200' },
          { key: 'confirmed', label: 'Confirmed',   cls: 'bg-green-50 text-green-700 border-green-200' },
          { key: 'responded', label: 'Responded',   cls: 'bg-blue-50 text-blue-700 border-blue-200' },
        ] as const).map(({ key, label, cls }) => {
          const count = key === 'all' ? contacts.length : contacts.filter(c => c.status === key).length
          const active = statusFilter === key
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${active ? cls : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
            >
              {key === 'confirmed' && <Trophy size={11} />}
              {key === 'responded' && <Reply size={11} />}
              {label}
              <span className={`px-1.5 py-0.5 rounded-full text-xs ${active ? 'bg-white/70' : 'bg-gray-100'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Statuses</option>
          {ALL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={dncOnly} onChange={(e) => setDncOnly(e.target.checked)} className="rounded" />
          <Ban size={13} className="text-red-500" /> DNC only
        </label>
        <div className="flex border border-gray-300 rounded-lg overflow-hidden ml-auto">
          <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 text-sm flex items-center gap-1.5 ${viewMode === 'list' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
            <List size={13} /> List
          </button>
          <button onClick={() => setViewMode('building')} className={`px-3 py-1.5 text-sm flex items-center gap-1.5 border-l border-gray-300 ${viewMode === 'building' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
            <Building2 size={13} /> By Building
          </button>
        </div>
      </div>

      {/* Success banner */}
      {deleteSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-2.5 rounded-xl mb-4 flex items-center justify-between">
          <span>✓ {deleteSuccess}</span>
          <button onClick={() => setDeleteSuccess('')} className="text-green-500 hover:text-green-700 text-xs">✕</button>
        </div>
      )}

      {/* Bulk action bar */}
      {someSelected && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-4 flex items-center gap-3 flex-wrap">
          <CheckSquare size={14} className="text-blue-600 shrink-0" />
          <span className="text-sm font-medium text-blue-800">{selected.size} selected</span>
          <div className="flex gap-2 ml-2 flex-wrap">
            <button onClick={() => bulkSetStatus('confirmed')} className="flex items-center gap-1 px-3 py-1 text-xs bg-green-100 text-green-800 rounded-lg hover:bg-green-200 font-medium"><Trophy size={10} /> Confirmed</button>
            <button onClick={() => bulkSetStatus('responded')} className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-100 text-blue-800 rounded-lg hover:bg-blue-200 font-medium"><Reply size={10} /> Responded</button>
            <button onClick={() => bulkSetStatus('interested')} className="px-3 py-1 text-xs bg-emerald-100 text-emerald-800 rounded-lg hover:bg-emerald-200">Interested</button>
            <button onClick={() => bulkSetStatus('not_interested')} className="px-3 py-1 text-xs bg-orange-100 text-orange-800 rounded-lg hover:bg-orange-200">Not Interested</button>
            <button onClick={() => bulkSetDnc(true)} className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200">Add to DNC</button>
            <button onClick={() => bulkSetDnc(false)} className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Remove DNC</button>
            <button
              onClick={() => setConfirmDeleteOpen(true)}
              className="px-3 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
            >
              Delete Selected
            </button>
          </div>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-blue-500 hover:text-blue-700">Clear</button>
        </div>
      )}

      {/* Bulk delete confirmation dialog */}
      {confirmDeleteOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Delete {selected.size} contact{selected.size === 1 ? '' : 's'}?</h3>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to delete {selected.size} contact{selected.size === 1 ? '' : 's'}? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteOpen(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={bulkDelete}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
              >
                Delete {selected.size} contact{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : viewMode === 'building' ? (
        <BuildingView groups={buildingGroups} onEdit={(c) => { setEditing(c); setShowForm(true) }} onToggleDnc={toggleDnc} onDelete={deleteContact} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No contacts found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-gray-500">
                  <th className="px-4 py-3">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                  </th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Address</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Added</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((c) => (
                  <tr key={c.id} className={`hover:bg-gray-50 ${selected.has(c.id) ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} className="rounded" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {c.do_not_contact && <Ban size={12} className="text-red-400 shrink-0" />}
                        {c.status === 'confirmed' && <Trophy size={12} className="text-green-600 shrink-0" />}
                        {c.status === 'responded' && <Reply size={12} className="text-blue-500 shrink-0" />}
                        <Link href={`/contacts/${c.id}`} className="font-medium text-gray-900 hover:text-blue-600">{c.name}</Link>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-900">{c.email}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell max-w-[160px] truncate">{c.address || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {c.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 hidden lg:table-cell">{formatDate(c.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => { setEditing(c); setShowForm(true) }} className="text-blue-600 hover:text-blue-800 text-xs">Edit</button>
                        <button onClick={() => toggleDnc(c)} className={`text-xs ${c.do_not_contact ? 'text-green-600 hover:text-green-800' : 'text-red-500 hover:text-red-700'}`}>
                          {c.do_not_contact ? 'Remove DNC' : 'DNC'}
                        </button>
                        <button onClick={() => deleteContact(c.id)} className="text-gray-400 hover:text-red-600 text-xs">Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showForm && (
        <ContactFormModal
          contact={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSave={() => { setShowForm(false); setEditing(null); load() }}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImport={() => { setShowImport(false); load() }}
        />
      )}
    </div>
  )
}

// ── Building View ─────────────────────────────────────────────────────────────
function BuildingView({
  groups,
  onEdit,
  onToggleDnc,
  onDelete,
}: {
  groups: { sorted: [string, { contacts: Contact[]; contacted: number }][]; noAddress: Contact[] }
  onEdit: (c: Contact) => void
  onToggleDnc: (c: Contact) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      {groups.sorted.map(([building, { contacts, contacted }]) => (
        <div key={building} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 text-left"
            onClick={() => setOpen(open === building ? null : building)}
          >
            <div className="flex items-center gap-3">
              <Building2 size={16} className="text-gray-400" />
              <span className="font-medium text-gray-900">{building}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-gray-500">{contacted} of {contacts.length} contacted</span>
              <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${contacts.length ? (contacted / contacts.length) * 100 : 0}%` }}
                />
              </div>
              <span className="text-gray-400">{open === building ? '▲' : '▼'}</span>
            </div>
          </button>

          {open === building && (
            <table className="w-full text-sm border-t border-gray-100">
              <tbody className="divide-y divide-gray-50">
                {contacts.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        {c.do_not_contact && <Ban size={11} className="text-red-400" />}
                        <Link href={`/contacts/${c.id}`} className="font-medium text-gray-900 hover:text-blue-600">{c.name}</Link>
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-gray-900">{c.email}</td>
                    <td className="px-5 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {c.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex gap-2">
                        <button onClick={() => onEdit(c)} className="text-blue-600 text-xs hover:text-blue-800">Edit</button>
                        <button onClick={() => onToggleDnc(c)} className={`text-xs ${c.do_not_contact ? 'text-green-600' : 'text-red-500'}`}>
                          {c.do_not_contact ? 'Remove DNC' : 'DNC'}
                        </button>
                        <button onClick={() => onDelete(c.id)} className="text-gray-400 text-xs hover:text-red-600">Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {groups.noAddress.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500 mb-2">No address ({groups.noAddress.length})</p>
          <div className="space-y-1">
            {groups.noAddress.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <Link href={`/contacts/${c.id}`} className="text-gray-900 hover:text-blue-600">{c.name}</Link>
                <span className="text-gray-400">— {c.email}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Contact Form Modal ────────────────────────────────────────────────────────
function ContactFormModal({ contact, onClose, onSave }: { contact: Contact | null; onClose: () => void; onSave: () => void }) {
  const supabase = createClient()
  const [form, setForm] = useState({
    name: contact?.name ?? '',
    email: contact?.email ?? '',
    address: contact?.address ?? '',
    phone: contact?.phone ?? '',
    company: contact?.company ?? '',
    status: (contact?.status ?? 'new') as ContactStatus,
    tags: contact?.tags?.join(', ') ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!form.name || !form.email) { setError('Name and email are required.'); return }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      name: form.name, email: form.email,
      address: form.address || null, phone: form.phone || null,
      company: form.company || null, status: form.status,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      user_id: user!.id,
    }
    const { error } = contact
      ? await supabase.from('contacts').update(payload).eq('id', contact.id)
      : await supabase.from('contacts').insert(payload)
    if (error) { setError(error.message); setSaving(false) } else onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">{contact ? 'Edit Contact' : 'Add Contact'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {([
            ['Name *', 'name', 'text'],
            ['Email *', 'email', 'email'],
            ['Company', 'company', 'text'],
            ['Phone', 'phone', 'tel'],
            ['Address', 'address', 'text'],
            ['Tags (comma-separated)', 'tags', 'text'],
          ] as [string, keyof typeof form, string][]).map(([label, key, type]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <input type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ContactStatus })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {ALL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</option>)}
            </select>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Fuzzy name→email matching helpers ────────────────────────────────────────

function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? []
}

function nameEmailScore(name: string, email: string): number {
  const local = email.split('@')[0]
  const nameTokens = tokens(name)
  const emailTokens = tokens(local)
  let score = 0
  for (const nt of nameTokens) {
    for (const et of emailTokens) {
      if (nt.length >= 3 && et.includes(nt)) score += nt.length
      else if (et.length >= 3 && nt.includes(et)) score += et.length
    }
  }
  return score
}

type PreviewContact = {
  name: string
  email: string
  address: string | null
  phone: string | null
  startDate: string | null
}

function matchNamesToEmails(
  names: string[],
  emails: string[],
  shared: { address: string | null; phone: string | null; startDate: string | null }
): { contacts: PreviewContact[]; skipped: string[] } {
  const contacts: PreviewContact[] = []
  const skipped: string[] = []

  if (emails.length === 0) return { contacts, skipped }

  if (names.length === 1 && emails.length === 1) {
    contacts.push({ name: names[0], email: emails[0], ...shared })
    return { contacts, skipped }
  }

  if (names.length === 1 && emails.length > 1) {
    emails.forEach((email, i) => contacts.push({ name: i === 0 ? names[0] : '', email, ...shared }))
    return { contacts, skipped }
  }

  if (names.length === 0) {
    emails.forEach((email) => contacts.push({ name: '', email, ...shared }))
    return { contacts, skipped }
  }

  const scored: { name: string; email: string; score: number }[] = []
  for (const n of names) {
    for (const e of emails) {
      scored.push({ name: n, email: e, score: nameEmailScore(n, e) })
    }
  }
  scored.sort((a, b) => b.score - a.score)

  const usedNames = new Set<string>()
  const usedEmails = new Set<string>()

  for (const { name, email, score } of scored) {
    if (usedNames.has(name) || usedEmails.has(email)) continue
    if (score === 0 && names.length > emails.length) continue
    usedNames.add(name)
    usedEmails.add(email)
    contacts.push({ name, email, ...shared })
  }

  for (const name of names) {
    if (usedNames.has(name)) continue
    const freeEmail = emails.find((e) => !usedEmails.has(e))
    if (freeEmail) {
      usedNames.add(name)
      usedEmails.add(freeEmail)
      contacts.push({ name, email: freeEmail, ...shared })
    } else {
      skipped.push(name)
    }
  }

  for (const email of emails) {
    if (!usedEmails.has(email)) {
      contacts.push({ name: '', email, ...shared })
    }
  }

  return { contacts, skipped }
}

// ── Import Modal ──────────────────────────────────────────────────────────────
function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: () => void }) {
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [stage, setStage] = useState<'upload' | 'preview' | 'done'>('upload')
  const [preview, setPreview] = useState<PreviewContact[]>([])
  const [guarantorSkipped, setGuarantorSkipped] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(0)
  const [error, setError] = useState('')

  function parseFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = e.target?.result
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][]
        if (raw.length < 2) { setError('File must have a header row and at least one data row.'); return }

        const headers = (raw[0] as string[]).map(String)
        const autoMap: Record<string, string> = {}
        headers.forEach((h) => {
          const norm = normalizeHeader(h)
          if (COL_MAP[norm]) autoMap[h] = COL_MAP[norm]
          if (['start_date', 'startdate', 'start'].includes(norm)) autoMap[h] = 'startdate'
          if (['apt', 'apt_number', 'aptno'].includes(norm)) autoMap[h] = 'unit'
        })
        setMapping(autoMap)

        const parsed = raw.slice(1).map((row) => {
          const obj: Record<string, string> = {}
          headers.forEach((h, i) => { obj[h] = String(row[i] ?? '').trim() })
          return obj
        }).filter((r) => Object.values(r).some((v) => v))

        setRows(parsed)
        setError('')
      } catch {
        setError('Could not parse file. Use CSV or Excel (.xlsx) format.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function getMapped(row: Record<string, string>, field: string): string | null {
    const col = Object.entries(mapping).find(([, v]) => v === field)?.[0]
    return col ? (row[col] || null) : null
  }

  function buildPreview() {
    const allContacts: PreviewContact[] = []
    const allSkipped: string[] = []
    const seenEmails = new Set<string>()

    for (const row of rows) {
      const rawEmail = getMapped(row, 'email') ?? ''
      const rawName = getMapped(row, 'name') ?? ''
      const unit = getMapped(row, 'unit')
      const baseAddress = getMapped(row, 'address')
      const address = baseAddress && unit ? `${baseAddress}, Apt ${unit}` : (baseAddress || null)
      const phone = getMapped(row, 'phone')
      const startDate = getMapped(row, 'startdate')

      const emails = rawEmail
        .split(/[&;,]/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@') && !seenEmails.has(e))

      const names = rawName
        .split(/\s*&\s*|\s*;\s*|\s*,\s*|\s+and\s+/i)
        .map((n) => n.trim())
        .filter(Boolean)

      const { contacts, skipped } = matchNamesToEmails(names, emails, { address, phone, startDate })

      for (const c of contacts) {
        if (seenEmails.has(c.email)) continue
        seenEmails.add(c.email)
        allContacts.push(c)
      }
      allSkipped.push(...skipped)
    }

    setPreview(allContacts)
    setGuarantorSkipped(allSkipped)
    setStage('preview')
  }

  async function doImport() {
    setImporting(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()

    const records = preview
      .filter((c) => c.email.includes('@'))
      .map((c) => ({
        user_id: user!.id,
        name: c.name || c.email.split('@')[0],
        email: c.email,
        phone: c.phone,
        address: c.address,
        status: 'new',
        do_not_contact: false,
      }))

    const CHUNK = 50
    let saved = 0
    const errors: string[] = []

    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK)
      const { error: insertError } = await supabase.from('contacts').insert(chunk)
      if (insertError) errors.push(`Rows ${i + 1}–${i + chunk.length}: ${insertError.message}`)
      else saved += chunk.length
    }

    setDone(saved)
    if (errors.length > 0) setError(errors.join('\n'))
    setImporting(false)
    setStage('done')
    if (saved > 0) setTimeout(onImport, 2000)
  }

  const availableFields = ['name', 'email', 'phone', 'address', 'unit', 'startdate', 'company']
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []
  const hasStartDate = preview.some((c) => c.startDate)

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 shrink-0">
          <h2 className="font-semibold text-gray-900">Import Contacts</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">

          {/* ── Upload ── */}
          {stage === 'upload' && rows.length === 0 && (
            <div>
              <p className="text-sm text-gray-500 mb-3">Upload a CSV or Excel file with columns: Name, Email, Address, Apt, Phone, Start Date.</p>
              <div
                className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) parseFile(f) }}
              >
                <Upload size={24} className="mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-600">Drop file here or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">Supports CSV, XLS, XLSX</p>
              </div>
              <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f) }} />
              {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            </div>
          )}

          {/* ── Column mapping ── */}
          {stage === 'upload' && rows.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-700 font-medium">{rows.length} rows found</p>
                <button onClick={() => { setRows([]); setMapping({}); setError('') }} className="text-xs text-gray-400 hover:text-gray-600">← Choose different file</button>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">Column Mapping</p>
                <div className="grid grid-cols-2 gap-2">
                  {headers.map((h) => (
                    <div key={h} className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500 truncate flex-1 max-w-[120px]">{h}</span>
                      <span className="text-gray-400">→</span>
                      <select
                        value={mapping[h] ?? ''}
                        onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                        className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">Skip</option>
                        {availableFields.map((f) => <option key={f} value={f}>{f === 'startdate' ? 'start date' : f}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
            </>
          )}

          {/* ── Preview ── */}
          {stage === 'preview' && (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{preview.length} contacts ready to import</p>
                  {guarantorSkipped.length > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      {guarantorSkipped.length} name{guarantorSkipped.length > 1 ? 's' : ''} skipped as guarantor{guarantorSkipped.length > 1 ? 's' : ''}:{' '}
                      {guarantorSkipped.join(', ')}
                    </p>
                  )}
                </div>
                <button onClick={() => { setStage('upload'); setPreview([]); setGuarantorSkipped([]) }} className="text-xs text-gray-400 hover:text-gray-600 shrink-0">← Back</button>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Email</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Address</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Phone</th>
                      {hasStartDate && <th className="px-3 py-2 text-left font-medium text-gray-600">Start Date</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.map((c, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-900">{c.name || <span className="text-gray-400 italic">—</span>}</td>
                        <td className="px-3 py-2 text-gray-700">{c.email}</td>
                        <td className="px-3 py-2 text-gray-500 max-w-[180px] truncate">{c.address || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{c.phone || '—'}</td>
                        {hasStartDate && <td className="px-3 py-2 text-gray-500">{c.startDate || '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {error && <pre className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg p-3 whitespace-pre-wrap">{error}</pre>}
            </>
          )}

          {/* ── Done ── */}
          {stage === 'done' && (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                <span className="text-green-600 text-xl">✓</span>
              </div>
              <p className="text-lg font-semibold text-gray-900">{done} contact{done !== 1 ? 's' : ''} imported</p>
              {guarantorSkipped.length > 0 && (
                <p className="text-sm text-gray-500 mt-1">{guarantorSkipped.length} guarantor name{guarantorSkipped.length > 1 ? 's' : ''} skipped</p>
              )}
              {error && <pre className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg p-3 whitespace-pre-wrap mt-4 text-left">{error}</pre>}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
            {stage === 'done' ? 'Close' : 'Cancel'}
          </button>
          {stage === 'upload' && rows.length > 0 && (
            <button
              onClick={buildPreview}
              disabled={!Object.values(mapping).includes('email')}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              Preview →
            </button>
          )}
          {stage === 'preview' && (
            <button
              onClick={doImport}
              disabled={importing || preview.length === 0}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {importing ? 'Importing…' : `Import ${preview.length} Contacts`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
