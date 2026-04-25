import { getAuthUrl } from '@/lib/gmail'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Embed the user ID in the OAuth state so the callback can identify the user
  // without relying on the session cookie (which Google's redirect drops).
  const url = getAuthUrl(user.id)
  return NextResponse.redirect(url)
}
