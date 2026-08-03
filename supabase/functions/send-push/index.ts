// Edge function: sends a native push notification for a single row in the
// `notifications` table. Triggered automatically by the
// `notifications_send_push` trigger (see supabase/migrations/0016_push_notifications.sql)
// right after any in-app notification is created - not meant to be called
// directly by the frontend.
//
// Android tokens go through Firebase Cloud Messaging's HTTP v1 API, since
// Android registers through Google Play Services/FCM natively and the token
// Capacitor returns there already IS a real FCM registration token.
//
// iOS tokens go DIRECTLY to Apple's push service (APNs) instead. Capacitor's
// push-notifications plugin on iOS talks to APNs directly (no Firebase SDK
// involved on the client), so the token it returns is a raw Apple device
// token - not an FCM registration token. Sending that token to FCM's API
// gets rejected outright (confirmed live: FCM returned 400/INVALID_ARGUMENT
// for a real, valid device token). Talking to Apple directly sidesteps that
// mismatch entirely.
//
// Deploy: supabase functions deploy send-push --no-verify-jwt
// Secrets needed (supabase secrets set ...):
//   CRON_SECRET                    - same shared secret used by send-reminders;
//                                     caller must send `Authorization: Bearer <CRON_SECRET>`
//   FIREBASE_SERVICE_ACCOUNT_JSON  - the full JSON key downloaded from
//                                     Firebase Console > Project Settings >
//                                     Service Accounts > Generate new private key.
//                                     Paste the entire file contents as-is.
//                                     (Android only.)
//   APNS_KEY_ID                    - the 10-character Key ID shown when you
//                                     created the APNs Authentication Key in
//                                     Apple Developer portal (also in the
//                                     downloaded filename: AuthKey_<ID>.p8).
//   APNS_TEAM_ID                   - your Apple Developer Team ID.
//   APNS_PRIVATE_KEY               - the full contents of that .p8 file, as-is.
//
// FCM HTTP v1 and APNs's provider API both require a signed JWT rather than
// a static server key you can just paste in - both are hand-signed below
// with Deno's Web Crypto API, since neither the Firebase Admin SDK nor
// Apple's server libraries are available in the edge runtime.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const FIREBASE_SERVICE_ACCOUNT_JSON = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') ?? ''
const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID') ?? ''
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID') ?? ''
const APNS_PRIVATE_KEY = Deno.env.get('APNS_PRIVATE_KEY') ?? ''
const APNS_TOPIC = 'com.postalcolony.shuttlerides'
// TestFlight/App Store builds are always signed with a Distribution
// provisioning profile, which Xcode pairs with the production APNs
// environment at archive time regardless of what's in the source
// entitlements file - so this app's installed builds only ever need the
// production APNs host, never the sandbox one.
const APNS_HOST = 'https://api.push.apple.com'

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
    .replace(/-----BEGIN (PRIVATE KEY|EC PRIVATE KEY)-----/, '')
    .replace(/-----END (PRIVATE KEY|EC PRIVATE KEY)-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// ---------------------------------------------------------------------------
// Android: Firebase Cloud Messaging (HTTP v1)
// ---------------------------------------------------------------------------

// In-memory only - edge function instances are short-lived, so this just
// avoids re-signing a JWT + round-tripping to Google on every notification
// within the same warm instance. Not a correctness requirement.
let cachedFcmAccessToken: { token: string; expiresAt: number } | null = null

async function getFcmAccessToken(serviceAccount: { client_email: string; private_key: string }): Promise<string> {
  if (cachedFcmAccessToken && cachedFcmAccessToken.expiresAt > Date.now() + 30_000) {
    return cachedFcmAccessToken.token
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
  cachedFcmAccessToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return json.access_token
}

async function sendFcmMessage(
  projectId: string,
  accessToken: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<{ ok: boolean; status: number; stale: boolean }> {
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
      },
    }),
  })
  const json = await resp.json().catch(() => ({}))
  const errorStatus = json?.error?.status
  // FCM's way of saying "this token is dead, stop using it".
  const stale = !resp.ok && (errorStatus === 'UNREGISTERED' || errorStatus === 'NOT_FOUND' || errorStatus === 'INVALID_ARGUMENT')
  return { ok: resp.ok, status: resp.status, stale }
}

// ---------------------------------------------------------------------------
// iOS: Apple Push Notification service (APNs), talked to directly
// ---------------------------------------------------------------------------

let cachedApnsProviderToken: { token: string; mintedAt: number } | null = null

async function getApnsProviderToken(): Promise<string> {
  // Apple requires this token be re-minted at least once an hour; refreshing
  // every 55 minutes leaves margin without re-signing on every request.
  if (cachedApnsProviderToken && Date.now() - cachedApnsProviderToken.mintedAt < 55 * 60 * 1000) {
    return cachedApnsProviderToken.token
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', kid: APNS_KEY_ID }
  const claim = { iss: APNS_TEAM_ID, iat: now }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(APNS_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
  // Web Crypto's ECDSA signature output is already the raw (r || s) format
  // JWTs expect for ES256 - unlike some other libraries, no DER conversion
  // is needed here.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  )
  const jwt = `${signingInput}.${base64url(signature)}`
  cachedApnsProviderToken = { token: jwt, mintedAt: Date.now() }
  return jwt
}

async function sendApnsMessage(
  deviceToken: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<{ ok: boolean; status: number; stale: boolean }> {
  const providerToken = await getApnsProviderToken()
  const resp = await fetch(`${APNS_HOST}/3/device/${deviceToken}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${providerToken}`,
      'apns-topic': APNS_TOPIC,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      aps: { alert: { title, body }, sound: 'default' },
      ...data,
    }),
  })
  // A dead token gets a 410 (Unregistered) or a 400 with reason
  // BadDeviceToken - either way, stop using it.
  const json = await resp.json().catch(() => ({}))
  const stale = resp.status === 410 || (resp.status === 400 && json?.reason === 'BadDeviceToken')
  return { ok: resp.ok, status: resp.status, stale }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const auth = req.headers.get('Authorization') ?? ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return jsonResponse({ error: 'unauthorized' }, 401)
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

    const data = {
      type: notif.type,
      notification_id: notif.id,
      ride_request_id: notif.ride_request_id ?? '',
    }

    const iosTokens = tokens.filter((t) => t.platform === 'ios')
    const androidTokens = tokens.filter((t) => t.platform === 'android')

    const results: Array<{ token_id: string; platform: string; ok: boolean; status: number }> = []
    const staleTokenIds: string[] = []

    if (iosTokens.length > 0) {
      if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) {
        results.push(
          ...iosTokens.map((t) => ({ token_id: t.id, platform: t.platform, ok: false, status: 0 }))
        )
      } else {
        for (const t of iosTokens) {
          const result = await sendApnsMessage(t.token, notif.title, notif.body, data)
          results.push({ token_id: t.id, platform: t.platform, ok: result.ok, status: result.status })
          if (result.stale) staleTokenIds.push(t.id)
        }
      }
    }

    if (androidTokens.length > 0) {
      if (!FIREBASE_SERVICE_ACCOUNT_JSON) {
        results.push(
          ...androidTokens.map((t) => ({ token_id: t.id, platform: t.platform, ok: false, status: 0 }))
        )
      } else {
        const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON)
        const accessToken = await getFcmAccessToken(serviceAccount)
        for (const t of androidTokens) {
          const result = await sendFcmMessage(serviceAccount.project_id, accessToken, t.token, notif.title, notif.body, data)
          results.push({ token_id: t.id, platform: t.platform, ok: result.ok, status: result.status })
          if (result.stale) staleTokenIds.push(t.id)
        }
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
