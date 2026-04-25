import { getOAuthClient } from '@/lib/gmail'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  console.log('[gmail/callback] START', new Date().toISOString())

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state') // contains user ID set in auth route

  console.log('[gmail/callback] code present:', !!code)
  console.log('[gmail/callback] state (user id):', state ?? '(missing)')
  console.log('[gmail/callback] error param:', error ?? '(none)')
  console.log('[gmail/callback] SERVICE_ROLE_KEY length:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0)
  console.log('[gmail/callback] SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(not set)')

  const redirectBase = process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'

  if (error || !code) {
    console.log('[gmail/callback] early exit — error or no code')
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=${error ?? 'no_code'}`)
  }

  if (!state) {
    console.log('[gmail/callback] missing state param — cannot identify user')
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=missing_state`)
  }

  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

  if (!svcKey) {
    console.error('[gmail/callback] SUPABASE_SERVICE_ROLE_KEY is not set')
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=server_misconfigured`)
  }

  try {
    // Exchange code for tokens
    console.log('[gmail/callback] exchanging code for tokens…')
    const oauth2Client = getOAuthClient()
    const { tokens } = await oauth2Client.getToken(code)
    console.log('[gmail/callback] access_token present:', !!tokens.access_token)
    console.log('[gmail/callback] refresh_token present:', !!tokens.refresh_token)
    console.log('[gmail/callback] expiry_date:', tokens.expiry_date ?? null)
    oauth2Client.setCredentials(tokens)

    // Get the Gmail address for this token
    console.log('[gmail/callback] fetching Google userinfo…')
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2.userinfo.get()
    console.log('[gmail/callback] gmail address:', userInfo.email ?? null)

    // Write tokens to profiles using service role (no session cookie needed)
    const admin = createServiceClient(supabaseUrl, svcKey)

    const profileData: Record<string, string | null> = {
      id: state,
      gmail_access_token: tokens.access_token ?? null,
      gmail_token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      gmail_email: userInfo.email ?? null,
    }
    if (tokens.refresh_token) {
      profileData.gmail_refresh_token = tokens.refresh_token
    }

    console.log('[gmail/callback] upserting profile for user:', state)
    const { data: upsertData, error: upsertError } = await admin
      .from('profiles')
      .upsert(profileData, { onConflict: 'id', ignoreDuplicates: false })
      .select('id, gmail_email')

    console.log('[gmail/callback] upsert data:', upsertData)
    console.log('[gmail/callback] upsert error:', upsertError ? JSON.stringify(upsertError) : null)

    if (upsertError) throw new Error(`Supabase upsert failed: ${upsertError.message} (code: ${upsertError.code})`)

    console.log('[gmail/callback] SUCCESS — gmail_email saved:', userInfo.email)
    return NextResponse.redirect(`${redirectBase}/settings?gmailConnected=1`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gmail/callback] CAUGHT ERROR:', msg)
    console.error('[gmail/callback] full error:', JSON.stringify(err, Object.getOwnPropertyNames(err as object)))
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=${encodeURIComponent(msg)}`)
  }
}
