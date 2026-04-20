'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Profile, Contact } from '@/lib/types'
import { Ban, CheckCircle, XCircle } from 'lucide-react'

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [dncContacts, setDncContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(false)
  const supabase = createClient()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const [{ data: p }, { data: dnc }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user!.id).single(),
      supabase.from('contacts').select('*').eq('user_id', user!.id).eq('do_not_contact', true).order('name'),
    ])
    setProfile(p)
    setName(p?.full_name ?? '')
    setDncContacts(dnc ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function saveProfile() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('profiles').update({ full_name: name }).eq('id', user!.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function removeFromDnc(contactId: string) {
    await supabase.from('contacts').update({ do_not_contact: false }).eq('id', contactId)
    load()
  }

  function connectGmail() {
    window.location.href = '/api/gmail/auth'
  }

  async function disconnectGmail() {
    if (!confirm('Disconnect Gmail? You won\'t be able to send emails.')) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('profiles').update({
      gmail_access_token: null,
      gmail_refresh_token: null,
      gmail_token_expiry: null,
      gmail_email: null,
    }).eq('id', user!.id)
    load()
  }

  if (loading) return <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Profile */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Profile</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Full Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input
              value={profile?.email ?? ''}
              disabled
              className="w-full border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-500"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveProfile}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && (
            <span className="text-sm text-green-600 flex items-center gap-1">
              <CheckCircle size={14} /> Saved
            </span>
          )}
        </div>
      </section>

      {/* Gmail */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Gmail Integration</h2>
        <p className="text-xs text-gray-500 mb-4">
          Connect your Gmail account to send emails through your own address.
          We only request permission to send emails on your behalf.
        </p>

        {profile?.gmail_email ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle size={16} className="text-green-500" />
              <div>
                <p className="text-sm font-medium text-gray-800">Connected</p>
                <p className="text-xs text-gray-500">{profile.gmail_email}</p>
              </div>
            </div>
            <button
              onClick={disconnectGmail}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
            >
              <XCircle size={13} /> Disconnect
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-600">
              <XCircle size={16} />
              <span className="text-sm">Not connected</span>
            </div>
            <button
              onClick={connectGmail}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" xmlns="http://www.w3.org/2000/svg">
                <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
              </svg>
              Connect Gmail
            </button>
          </div>
        )}
      </section>

      {/* Do Not Contact List */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Ban size={16} className="text-red-500" />
          <h2 className="text-sm font-semibold text-gray-900">Do Not Contact List ({dncContacts.length})</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          These contacts are excluded from outreach. You can also toggle DNC status from the Contacts page.
        </p>

        {dncContacts.length === 0 ? (
          <p className="text-sm text-gray-400">No contacts on the DNC list.</p>
        ) : (
          <div className="space-y-2">
            {dncContacts.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                  <span className="text-sm font-medium text-gray-800">{c.name}</span>
                  <span className="text-xs text-gray-400 ml-2">{c.email}</span>
                </div>
                <button
                  onClick={() => removeFromDnc(c.id)}
                  className="text-xs text-green-600 hover:text-green-800"
                >
                  Remove from DNC
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
