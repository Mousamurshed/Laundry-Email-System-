import { getOAuthClient } from '@/lib/gmail'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  console.log('[gmail/callback] ════════════════════════════════════════════')
  console.log('[gmail/callback] START', new Date().toISOString())

  // ── 1. Environment variables ─────────────────────────────────────────────
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  console.log('[gmail/callback] ENV NEXT_PUBLIC_URL:', process.env.NEXT_PUBLIC_URL ?? '(not set)')
  console.log('[gmail/callback] ENV NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl || '(not set)')
  console.log('[gmail/callback] ENV NEXT_PUBLIC_SUPABASE_ANON_KEY length:', anonKey.length, '| prefix:', anonKey.slice(0, 20) || '(empty)')
  console.log('[gmail/callback] ENV SUPABASE_SERVICE_ROLE_KEY length:', svcKey.length, '| prefix:', svcKey.slice(0, 20) || '(empty)')
  console.log('[gmail/callback] ENV GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_ID.slice(0, 20) + '…' : '(not set)')
  console.log('[gmail/callback] ENV GOOGLE_CLIENT_SECRET length:', process.env.GOOGLE_CLIENT_SECRET?.length ?? 0)

  // ── 2. Request cookies (session check) ───────────────────────────────────
  const allCookies = request.cookies.getAll()
  console.log('[gmail/callback] cookies present:', allCookies.map(c => c.name))

  // ── 3. Code / error params ────────────────────────────────────────────────
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  console.log('[gmail/callback] code present:', !!code, '| code length:', code?.length ?? 0)
  console.log('[gmail/callback] error param:', error ?? '(none)')

  const redirectBase = process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'

  if (error || !code) {
    console.log('[gmail/callback] early exit — missing code or error param')
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=${error ?? 'no_code'}`)
  }

  // ── 4. Auth: get user from session cookie ────────────────────────────────
  console.log('[gmail/callback] calling supabase.auth.getUser()…')
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  console.log('[gmail/callback] getUser → user id:', user?.id ?? null)
  console.log('[gmail/callback] getUser → user email:', user?.email ?? null)
  console.log('[gmail/callback] getUser → auth error:', authError ? JSON.stringify(authError) : null)

  if (!user) {
    console.log('[gmail/callback] NO USER — session cookie not present or expired. Redirecting to login.')
    return NextResponse.redirect(`${redirectBase}/login`)
  }

  try {
    // ── 5. Token exchange ──────────────────────────────────────────────────
    console.log('[gmail/callback] exchanging code for tokens…')
    const oauth2Client = getOAuthClient()
    const { tokens } = await oauth2Client.getToken(code)
    console.log('[gmail/callback] tokens.access_token present:', !!tokens.access_token)
    console.log('[gmail/callback] tokens.refresh_token present:', !!tokens.refresh_token)
    console.log('[gmail/callback] tokens.expiry_date:', tokens.expiry_date ?? null)
    console.log('[gmail/callback] tokens.scope:', tokens.scope ?? null)
    oauth2Client.setCredentials(tokens)

    // ── 6. Userinfo ────────────────────────────────────────────────────────
    console.log('[gmail/callback] fetching Google userinfo…')
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2.userinfo.get()
    console.log('[gmail/callback] Google email:', userInfo.email ?? null)

    // ── 7. Pre-check: does this profile row exist? ─────────────────────────
    if (!svcKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — cannot write to profiles')
    }
    const admin = createServiceClient(supabaseUrl, svcKey)

    const { data: existingProfile, error: selectError } = await admin
      .from('profiles')
      .select('id, gmail_email')
      .eq('id', user.id)
      .single()
    console.log('[gmail/callback] existing profile:', existingProfile ?? null)
    console.log('[gmail/callback] profile select error:', selectError ? JSON.stringify(selectError) : null)

    // ── 8. Upsert ──────────────────────────────────────────────────────────
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
    console.log('[gmail/callback] upserting profileData:', {
      ...profileData,
      gmail_access_token: profileData.gmail_access_token ? '[REDACTED len=' + profileData.gmail_access_token.length + ']' : null,
      gmail_refresh_token: profileData.gmail_refresh_token ? '[REDACTED]' : undefined,
    })

    const { data: upsertData, error: upsertError } = await admin
      .from('profiles')
      .upsert(profileData, { onConflict: 'id', ignoreDuplicates: false })
      .select('id, gmail_email')

    console.log('[gmail/callback] upsert data:', upsertData)
    console.log('[gmail/callback] upsert error:', upsertError ? JSON.stringify(upsertError) : null)

    if (upsertError) throw new Error(`Supabase upsert failed: ${upsertError.message} (code: ${upsertError.code})`)

    // ── 9. Verify the write actually landed ───────────────────────────────
    const { data: verifyRow } = await admin
      .from('profiles')
      .select('id, gmail_email, gmail_access_token')
      .eq('id', user.id)
      .single()
    console.log('[gmail/callback] post-upsert verify — gmail_email:', verifyRow?.gmail_email ?? null)
    console.log('[gmail/callback] post-upsert verify — access_token saved:', !!verifyRow?.gmail_access_token)

    console.log('[gmail/callback] ── SUCCESS ──────────────────────────────')
    return NextResponse.redirect(`${redirectBase}/settings?gmailConnected=1`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gmail/callback] ── CAUGHT ERROR:', msg)
    console.error('[gmail/callback] full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err as object)))
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=${encodeURIComponent(msg)}`)
  }
}
