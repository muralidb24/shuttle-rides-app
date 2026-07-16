// Edge function: sends a native push notification (via Firebase Cloud
// Messaging's HTTP v1 API) for a single row in the `notifications` table.
// Triggered automatically by the `notifications_send_push` trigger
// (see supabase/migrations/0016_push_notifications.sql) right after any
// in-app notification is created - not meant to be called directly by the
// frontend.
//
// Deploy: supabase functions deploy send-push --no-verify-jwt
// Secrets needed (supabase secrets set ...):
//   CRON_SECRET                    - same shared secret used by send-reminders;
//                                     caller must send `Authorization: Bearer <CRON_SECRET>`
//   FIREBASE_SERVICE_ACCOUNT_JSON  - the full JSON key downloaded from
//                                     Firebase Console > Project Settings >
//                                     Service Accounts > Generate new private key.
//                                     Paste the entire file contents as-is.
//
// FCM HTTP v1 requires an OAuth2 access token minted from that service
// account (there's no more "server key" you can just paste in) - the JWT
// signing below does that by hand with Deno's Web Crypto API, since the
// Firebase Admin SDK isn't available in the edge runtime.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const FIREBASE_SERVICE_ACCOUNT_JSON = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') ?? ''

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// In-memory only - edge function instances are short-lived, so this just
// avoids re-signing a JWT + round-tripping to Google on every notification
// within the same warm instance. Not a correctness requirement.
let cachedAccessToken: { token: string; expiresAt: number } | null = null

async function getFcmAccessToken(serviceAccount: { client_email: string; private_key: string }): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30_000) {
    return cachedAccessToken.token
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  )
  const jwt = `${signingInput}.${base64url(signature)}`

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  })
  const json = await resp.json()
  if (!resp.ok || !json.access_token) {
    throw new Error(`Failed to mint FCM access token: ${JSON.stringify(json)}`)
  }
  cachedAccessToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return json.access_token
}

interface FcmResult {
  ok: boolean
  status: number
  errorStatus?: string
}

async function sendFcmMessage(
  projectId: string,
  accessToken: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<FcmResult> {
  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data,
        android: { priority: 'high' },
        apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
      },
    }),
  })
  const json = await resp.json().catch(() => ({}))
  return { ok: resp.ok, status: resp.status, errorStatus: json?.error?.status }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const auth = req.headers.get('Authorization') ?? ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  if (!FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Not configured yet - a harmless no-op rather than an error, same
    // stance as trigger_send_reminders() before CRON_SECRET was set in Vault.
    return jsonResponse({ ok: true, skipped: 'FIREBASE_SERVICE_ACCOUNT_JSON not set' })
  }

  let notificationId: string | undefined
  try {
    const payload = await req.json()
    notificationId = payload.notification_id
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400)
  }

  if (!notificationId) {
    return jsonResponse({ error: 'notification_id required' }, 400)
  }

  try {
    const { data: notif, error: notifErr } = await supabaseAdmin
      .from('notifications')
      .select('id, user_id, type, title, body, ride_request_id')
      .eq('id', notificationId)
      .single()

    if (notifErr || !notif) {
      return jsonResponse({ ok: true, skipped: 'notification not found (may have been deleted already)' })
    }

    const { data: tokens, error: tokensErr } = await supabaseAdmin
      .from('push_tokens')
      .select('id, token, platform')
      .eq('user_id', notif.user_id)

    if (tokensErr) throw tokensErr
    if (!tokens || tokens.length === 0) {
      return jsonResponse({ ok: true, sent: 0, reason: 'recipient has no registered devices' })
    }

    const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON)
    const accessToken = await getFcmAccessToken(serviceAccount)

    const results: Array<{ token_id: string; platform: string; ok: boolean; status: number }> = []
    const staleTokenIds: string[] = []

    for (const t of tokens) {
      const result = await sendFcmMessage(
        serviceAccount.project_id,
        accessToken,
        t.token,
        notif.title,
        notif.body,
        {
          type: notif.type,
          notification_id: notif.id,
          ride_request_id: notif.ride_request_id ?? '',
        }
      )
      results.push({ token_id: t.id, platform: t.platform, ok: result.ok, status: result.status })

      // FCM's way of saying "this token is dead, stop using it" - clean it
      // up so future notifications don't keep paying the round-trip cost.
      if (!result.ok && (result.errorStatus === 'UNREGISTERED' || result.errorStatus === 'NOT_FOUND' || result.errorStatus === 'INVALID_ARGUMENT')) {
        staleTokenIds.push(t.id)
      }
    }

    if (staleTokenIds.length > 0) {
      await supabaseAdmin.from('push_tokens').delete().in('id', staleTokenIds)
    }

    return jsonResponse({ ok: true, sent: results.length, results, cleaned_up: staleTokenIds.length })
  } catch (err) {
    console.error(err)
    return jsonResponse({ ok: false, error: String(err) }, 500)
  }
})
