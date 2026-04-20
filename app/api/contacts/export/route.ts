import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('contacts')
    .select('name,email,company,phone,address,status,do_not_contact,tags,created_at')
    .eq('user_id', user.id)
    .order('name')

  if (!data?.length) return new NextResponse('name,email\n', {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="contacts.csv"' }
  })

  const headers = ['name', 'email', 'company', 'phone', 'address', 'status', 'do_not_contact', 'tags', 'created_at']
  const rows = data.map((row) =>
    headers.map((h) => {
      const val = (row as Record<string, unknown>)[h]
      if (val === null || val === undefined) return ''
      const str = Array.isArray(val) ? val.join(';') : String(val)
      return /[,"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
    }).join(',')
  )

  const csv = [headers.join(','), ...rows].join('\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="contacts.csv"',
    }
  })
}
