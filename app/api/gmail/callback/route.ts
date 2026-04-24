import { getOAuthClient } from '@/lib/gmail'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  console.log('[gmail/callback] ── START ──────────────────────────────────')

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  console.log('[gmail/callback] code present:', !!code)
  console.log('[gmail/callback] error param:', error)
  console.log('[gmail/callback] NEXT_PUBLIC_URL:', process.env.NEXT_PUBLIC_URL)
  console.log('[gmail/callback] NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)
  console.log('[gmail/callback] SERVICE_ROLE_KEY present:', !!process.env.SUPABASE_SERVICE_ROLE_KEY)
  console.log('[gmail/callback] SERVICE_ROLE_KEY length:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0)
  console.log('[gmail/callback] GOOGLE_CLIENT_ID present:', !!process.env.GOOGLE_CLIENT_ID)
  console.log('[gmail/callback] GOOGLE_CLIENT_SECRET present:', !!process.env.GOOGLE_CLIENT_SECRET)

  const redirectBase = process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'

  if (error || !code) {
    console.log('[gmail/callback] early exit — no code or error param')
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=${error ?? 'no_code'}`)
  }

  // Verify the logged-in user via the session cookie
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  console.log('[gmail/callback] getUser result — user id:', user?.id ?? null, '| auth error:', authError?.message ?? null)

  if (!user) {
    console.log('[gmail/callback] no authenticated user — redirecting to login')
    return NextResponse.redirect(`${redirectBase}/login`)
  }

  try {
    console.log('[gmail/callback] exchanging code for tokens…')
    const oauth2Client = getOAuthClient()
    const { tokens } = await oauth2Client.getToken(code)
    console.log('[gmail/callback] tokens received:')
    console.log('  access_token present:', !!tokens.access_token)
    console.log('  refresh_token present:', !!tokens.refresh_token)
    console.log('  expiry_date:', tokens.expiry_date)
    console.log('  token_type:', tokens.token_type)
    oauth2Client.setCredentials(tokens)

    console.log('[gmail/callback] fetching userinfo…')
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2.userinfo.get()
    console.log('[gmail/callback] userInfo.email:', userInfo.email)

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
    console.log('[gmail/callback] profileData to upsert:', {
      ...profileData,
      gmail_access_token: profileData.gmail_access_token ? '[REDACTED]' : null,
      gmail_refresh_token: profileData.gmail_refresh_token ? '[REDACTED]' : undefined,
    })

    console.log('[gmail/callback] creating service role client…')
    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    console.log('[gmail/callback] running upsert on profiles…')
    const { data: upsertData, error: upsertError } = await admin
      .from('profiles')
      .upsert(profileData, { onConflict: 'id', ignoreDuplicates: false })
      .select('id, gmail_email')

    console.log('[gmail/callback] upsert result — data:', upsertData, '| error:', upsertError)

    if (upsertError) throw new Error(upsertError.message)

    console.log('[gmail/callback] ── SUCCESS — redirecting to settings ──')
    return NextResponse.redirect(`${redirectBase}/settings?gmailConnected=1`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'OAuth error'
    console.error('[gmail/callback] ── CAUGHT ERROR:', msg, err)
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=${encodeURIComponent(msg)}`)
  }
}
