import { getOAuthClient } from '@/lib/gmail'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  console.log('[gmail/callback] START', new Date().toISOString())

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const errorParam = searchParams.get('error')
  const state = searchParams.get('state') // user ID set in auth route

  console.log('[gmail/callback] code present:', !!code)
  console.log('[gmail/callback] state:', state ?? '(missing)')
  console.log('[gmail/callback] errorParam:', errorParam ?? '(none)')
  console.log('[gmail/callback] SERVICE_ROLE_KEY length:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0)

  const redirectBase = process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'

  if (errorParam || !code) {
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=${errorParam ?? 'no_code'}`)
  }

  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

  if (!svcKey || !supabaseUrl) {
    console.error('[gmail/callback] missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL')
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=server_misconfigured`)
  }

  try {
    // ── 1. Exchange code for tokens ────────────────────────────────────────
    console.log('[gmail/callback] exchanging code for tokens…')
    const oauth2Client = getOAuthClient()
    const { tokens } = await oauth2Client.getToken(code)
    console.log('[gmail/callback] access_token present:', !!tokens.access_token)
    console.log('[gmail/callback] refresh_token present:', !!tokens.refresh_token)

    if (!tokens.access_token) throw new Error('No access_token returned from Google')

    // ── 2. Get Gmail email via userinfo endpoint ────────────────────────────
    console.log('[gmail/callback] fetching Google userinfo…')
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const userInfo = await userinfoRes.json() as { email?: string; id?: string }
    console.log('[gmail/callback] Google userinfo status:', userinfoRes.status)
    console.log('[gmail/callback] Google email:', userInfo.email ?? '(none)')

    if (!userInfo.email) throw new Error('Could not get email from Google userinfo')

    // ── 3. Find the matching profile using service role ────────────────────
    const admin = createServiceClient(supabaseUrl, svcKey)

    // Primary: match by state (user ID passed from auth route)
    // Fallback: match by email in profiles table
    let userId: string | null = state ?? null

    if (!userId) {
      console.log('[gmail/callback] no state param — finding user by email:', userInfo.email)
      const { data: profileByEmail, error: emailLookupError } = await admin
        .from('profiles')
        .select('id')
        .eq('email', userInfo.email)
        .single()

      console.log('[gmail/callback] profileByEmail:', profileByEmail)
      console.log('[gmail/callback] emailLookupError:', emailLookupError ? JSON.stringify(emailLookupError) : null)
      userId = profileByEmail?.id ?? null
    }

    if (!userId) {
      // Last resort: look up by email in auth.users via RPC or admin API
      console.log('[gmail/callback] profile not found by email, trying auth.users…')
      const { data: authUsers } = await admin.auth.admin.listUsers()
      const match = authUsers?.users?.find(u => u.email === userInfo.email)
      console.log('[gmail/callback] auth.users match:', match?.id ?? null)
      userId = match?.id ?? null
    }

    if (!userId) {
      throw new Error(`No user found matching Gmail address ${userInfo.email}`)
    }

    console.log('[gmail/callback] resolved userId:', userId)

    // ── 4. Upsert tokens into profiles ─────────────────────────────────────
    const profileData: Record<string, string | null> = {
      id: userId,
      gmail_access_token: tokens.access_token,
      gmail_token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      gmail_email: userInfo.email,
    }
    if (tokens.refresh_token) {
      profileData.gmail_refresh_token = tokens.refresh_token
    }

    console.log('[gmail/callback] upserting tokens for userId:', userId)
    const { data: upsertData, error: upsertError } = await admin
      .from('profiles')
      .upsert(profileData, { onConflict: 'id', ignoreDuplicates: false })
      .select('id, gmail_email')

    console.log('[gmail/callback] upsert result:', upsertData)
    console.log('[gmail/callback] upsert error:', upsertError ? JSON.stringify(upsertError) : null)

    if (upsertError) throw new Error(`Upsert failed: ${upsertError.message} (code: ${upsertError.code})`)

    console.log('[gmail/callback] SUCCESS — saved gmail_email:', userInfo.email)
    return NextResponse.redirect(`${redirectBase}/settings?gmailConnected=1`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gmail/callback] ERROR:', msg)
    return NextResponse.redirect(`${redirectBase}/settings?gmailError=${encodeURIComponent(msg)}`)
  }
}
