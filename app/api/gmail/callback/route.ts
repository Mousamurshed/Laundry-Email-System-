import { getOAuthClient } from '@/lib/gmail'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  const redirectBase = process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'

  if (error || !code) {
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=${error ?? 'no_code'}`)
  }

  // Verify the logged-in user via the session cookie
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${redirectBase}/login`)

  try {
    const oauth2Client = getOAuthClient()
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2.userinfo.get()

    // Build the fields to save. Only update refresh_token if Google sent one
    // (it's omitted on repeat flows unless prompt: 'consent' forced a new one).
    const profileData: Record<string, string | null> = {
      id: user.id,
      gmail_access_token: tokens.access_token ?? null,
      gmail_token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      gmail_email: userInfo.email ?? null,
    }
    if (tokens.refresh_token) {
      profileData.gmail_refresh_token = tokens.refresh_token
    }

    // Use service role so this upsert always succeeds regardless of RLS state.
    // We've already verified the user identity above via getUser().
    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { error: upsertError } = await admin
      .from('profiles')
      .upsert(profileData, { onConflict: 'id', ignoreDuplicates: false })

    if (upsertError) throw new Error(upsertError.message)

    return NextResponse.redirect(`${redirectBase}/settings?gmailConnected=1`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'OAuth error'
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=${encodeURIComponent(msg)}`)
  }
}
