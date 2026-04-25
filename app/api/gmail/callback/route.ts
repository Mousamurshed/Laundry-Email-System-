import { getOAuthClient } from '@/lib/gmail'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  console.log('[gmail/callback] ═══════════════════════════════════════════')
  console.log('[gmail/callback] START', new Date().toISOString())

  // ── Log every relevant env var ─────────────────────────────────────────
  const svcKey    = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const gclientId = process.env.GOOGLE_CLIENT_ID ?? ''
  const gclientSec = process.env.GOOGLE_CLIENT_SECRET ?? ''
  const nextPublicUrl = process.env.NEXT_PUBLIC_URL ?? ''

  console.log('[gmail/callback] ENV NEXT_PUBLIC_URL:', nextPublicUrl || '(not set)')
  console.log('[gmail/callback] ENV NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl || '(not set)')
  console.log('[gmail/callback] ENV NEXT_PUBLIC_SUPABASE_ANON_KEY length:', anonKey.length)
  console.log('[gmail/callback] ENV SUPABASE_SERVICE_ROLE_KEY length:', svcKey.length)
  console.log('[gmail/callback] ENV GOOGLE_CLIENT_ID length:', gclientId.length, '| value:', gclientId || '(not set)')
  console.log('[gmail/callback] ENV GOOGLE_CLIENT_SECRET length:', gclientSec.length)

  // ── Parse request ──────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url)
  const code       = searchParams.get('code')
  const errorParam = searchParams.get('error')
  const state      = searchParams.get('state')

  console.log('[gmail/callback] code present:', !!code, '| length:', code?.length ?? 0)
  console.log('[gmail/callback] state (userId):', state ?? '(missing)')
  console.log('[gmail/callback] error param:', errorParam ?? '(none)')

  const redirectBase = (nextPublicUrl || 'https://laundry-email-system.vercel.app').replace(/\/$/, '')

  if (errorParam || !code) {
    console.log('[gmail/callback] early exit — no code or error:', errorParam)
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=${errorParam ?? 'no_code'}`)
  }

  // ── Guard: required env vars ───────────────────────────────────────────
  if (!svcKey) {
    console.error('[gmail/callback] MISSING: SUPABASE_SERVICE_ROLE_KEY')
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=missing_SERVICE_ROLE_KEY`)
  }
  if (!supabaseUrl) {
    console.error('[gmail/callback] MISSING: NEXT_PUBLIC_SUPABASE_URL')
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=missing_SUPABASE_URL`)
  }
  if (!gclientId || !gclientSec) {
    console.error('[gmail/callback] MISSING: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET')
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=missing_google_credentials`)
  }

  try {
    // ── 1. Exchange code for tokens ────────────────────────────────────────
    console.log('[gmail/callback] exchanging code for tokens…')
    const oauth2Client = getOAuthClient()
    const { tokens } = await oauth2Client.getToken(code)
    console.log('[gmail/callback] tokens.access_token present:', !!tokens.access_token)
    console.log('[gmail/callback] tokens.refresh_token present:', !!tokens.refresh_token)
    console.log('[gmail/callback] tokens.expiry_date:', tokens.expiry_date ?? null)
    console.log('[gmail/callback] tokens.scope:', tokens.scope ?? null)

    if (!tokens.access_token) throw new Error('No access_token returned from Google')

    // ── 2. Get Gmail address from userinfo ────────────────────────────────
    console.log('[gmail/callback] fetching userinfo from Google…')
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    console.log('[gmail/callback] userinfo HTTP status:', userinfoRes.status)
    const userInfo = await userinfoRes.json() as { email?: string }
    console.log('[gmail/callback] userInfo.email:', userInfo.email ?? '(none)')

    if (!userInfo.email) throw new Error('Google userinfo returned no email')

    // ── 3. Resolve userId ──────────────────────────────────────────────────
    const admin = createServiceClient(supabaseUrl, svcKey)
    let userId: string | null = state ?? null
    console.log('[gmail/callback] userId from state param:', userId ?? '(none — will look up by email)')

    if (!userId) {
      const { data: byEmail, error: e1 } = await admin
        .from('profiles')
        .select('id')
        .eq('email', userInfo.email)
        .single()
      console.log('[gmail/callback] profiles lookup by email:', byEmail?.id ?? null, '| error:', e1?.message ?? null)
      userId = byEmail?.id ?? null
    }

    if (!userId) {
      const { data: authData } = await admin.auth.admin.listUsers()
      const match = authData?.users?.find(u => u.email === userInfo.email)
      console.log('[gmail/callback] auth.users lookup:', match?.id ?? '(no match)')
      userId = match?.id ?? null
    }

    if (!userId) throw new Error(`No Supabase user found for Gmail address: ${userInfo.email}`)
    console.log('[gmail/callback] resolved userId:', userId)

    // ── 4. Check profiles columns exist (defensive) ───────────────────────
    const { data: colCheck, error: colErr } = await admin
      .from('profiles')
      .select('id, gmail_email, gmail_access_token, gmail_refresh_token, gmail_token_expiry')
      .eq('id', userId)
      .single()
    console.log('[gmail/callback] current profile row:', colCheck ? JSON.stringify(colCheck) : null)
    console.log('[gmail/callback] column check error:', colErr?.message ?? null)

    // ── 5. Upsert tokens ───────────────────────────────────────────────────
    const profileData: Record<string, string | null> = {
      id: userId,
      gmail_access_token: tokens.access_token,
      gmail_token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      gmail_email: userInfo.email,
    }
    if (tokens.refresh_token) {
      profileData.gmail_refresh_token = tokens.refresh_token
    }

    console.log('[gmail/callback] upserting profile fields:', Object.keys(profileData).join(', '))
    const { data: upsertData, error: upsertError } = await admin
      .from('profiles')
      .upsert(profileData, { onConflict: 'id', ignoreDuplicates: false })
      .select('id, gmail_email')

    console.log('[gmail/callback] upsert data:', JSON.stringify(upsertData))
    console.log('[gmail/callback] upsert error:', upsertError ? JSON.stringify(upsertError) : null)

    if (upsertError) throw new Error(`Upsert failed: ${upsertError.message} (code: ${upsertError.code})`)

    console.log('[gmail/callback] ══ SUCCESS — gmail_email:', userInfo.email, '═══════════')
    return NextResponse.redirect(`${redirectBase}/settings?gmailConnected=1`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gmail/callback] ══ ERROR:', msg)
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=${encodeURIComponent(msg)}`)
  }
}
