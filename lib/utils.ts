// Strip parenthetical content and wrapping parens from a name
// "(John Smith)" → "John Smith", "John Smith (guarantor)" → "John Smith"
function sanitizeName(name: string): string {
  return name
    .replace(/\s*\(.*?\)\s*/g, ' ') // remove inline/trailing parenthetical
    .replace(/^\((.+)\)$/, '$1')     // unwrap fully wrapped "(name)"
    .trim()
}

// Strip apartment/unit suffix, leaving only the building street address
// "545 East 12th St #2C, Apt 2C" → "545 East 12th St"
// "100 Main St, Unit 4B" → "100 Main St"
export function buildingAddress(address: string): string {
  return address
    .replace(/\s*(?:,\s*)?(?:#\S+|(?:apt|apartment|unit|suite|ste|floor|fl)\.?\s*\S+).*/i, '')
    .trim()
}

// "Peter Rooney & Amanda White" → "Peter & Amanda"
// "Peter Rooney, Jenna Bass, Mark Smith" → "Peter, Jenna & Mark"
// "Peter Rooney and Amanda White" → "Peter & Amanda"
// "Cristian Castillo" → "Cristian"
function extractFirstNames(fullName: string): string {
  const parts = sanitizeName(fullName)
    .split(/\s*&\s*|\s*,\s*|\s+and\s+/i)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.split(/\s+/)[0])
    .filter(Boolean)

  if (parts.length === 0) return sanitizeName(fullName)
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} & ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`
}

export type ContactGroup = {
  contacts: { id: string; name: string; email: string; address: string | null; phone: string | null; company: string | null }[]
  toEmails: string[]
  combinedName: string
}

function normalizeAddressKey(address: string | null | undefined): string {
  if (!address?.trim()) return ''
  return address.toLowerCase().replace(/\s+/g, ' ').trim()
}

function firstNameOf(name: string): string {
  const clean = name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/^\((.+)\)$/, '$1').trim()
  return clean.split(/\s+/)[0] || clean
}

export function groupContactsByAddress(contacts: ContactGroup['contacts']): ContactGroup[] {
  const map = new Map<string, ContactGroup['contacts']>()
  for (const c of contacts) {
    const key = normalizeAddressKey(c.address) || `__noadr__${c.id}`
    const bucket = map.get(key)
    if (bucket) bucket.push(c)
    else map.set(key, [c])
  }
  return Array.from(map.values()).map(group => {
    const firstNames = group.map(c => firstNameOf(c.name)).filter(Boolean)
    const combinedName =
      firstNames.length === 0 ? (group[0]?.name ?? '') :
      firstNames.length === 1 ? firstNames[0] :
      firstNames.length === 2 ? `${firstNames[0]} & ${firstNames[1]}` :
      `${firstNames.slice(0, -1).join(', ')} & ${firstNames[firstNames.length - 1]}`
    // Split comma-separated emails stored in a single contact record (multi-tenant rows)
    const toEmails = group.flatMap(c =>
      c.email.split(/\s*[,;]\s*/).map(e => e.trim()).filter(Boolean)
    )
    return { contacts: group, toEmails, combinedName }
  })
}

export function replacePlaceholders(text: string, data: Record<string, string | null>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = data[key] ?? ''
    if (key === 'name') return extractFirstNames(value)
    if (key === 'address') return buildingAddress(sanitizeName(value))
    return value
  })
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function exportToCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return

  const headers = Object.keys(data[0])
  const rows = data.map((row) =>
    headers.map((h) => {
      const val = row[h]
      if (val === null || val === undefined) return ''
      const str = Array.isArray(val) ? val.join(';') : String(val)
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str
    }).join(',')
  )

  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const STATUS_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-gray-100 text-gray-800',
  prospect: 'bg-blue-100 text-blue-800',
  customer: 'bg-purple-100 text-purple-800',
  responded: 'bg-blue-100 text-blue-800',
  interested: 'bg-emerald-100 text-emerald-800',
  confirmed: 'bg-green-100 text-green-800',
  not_interested: 'bg-orange-100 text-orange-800',
  sent: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  scheduled: 'bg-yellow-100 text-yellow-800',
  cancelled: 'bg-gray-100 text-gray-800',
}

export function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  setter: (v: string) => void
) {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  const newVal = el.value.slice(0, start) + text + el.value.slice(end)
  setter(newVal)
  // Restore cursor position after React re-render
  requestAnimationFrame(() => {
    el.selectionStart = el.selectionEnd = start + text.length
    el.focus()
  })
}
