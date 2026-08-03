// Edge function: emails a single row in the `notifications` table. Triggered
// automatically by the `notifications_send_email` trigger (see
// supabase/migrations/0018_cancellation_email_and_reminder.sql) right after
// any in-app notification is created, EXCEPT type='ride_requested' (that one
// already gets a richer, custom-formatted email directly from the
// notify-neighbors edge function - this would otherwise double-email it).
// Not meant to be called directly by the frontend.
//
// Deploy: supabase functions deploy send-notification-email --no-verify-jwt
// Secrets needed (supabase secrets set ...):
//   RESEND_API_KEY, FROM_EMAIL, APP_URL  (same as notify-neighbors/send-reminders)
//   CRON_SECRET                          - same shared secret used by send-push/
//                                          send-reminders; caller must send
//                                          `Authorization: Bearer <CRON_SECRET>`

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'rides@example.com'
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173'

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const auth = req.headers.get('Authorization') ?? ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  if (!RESEND_API_KEY) {
    return jsonResponse({ ok: true, skipped: 'RESEND_API_KEY not set' })
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
      .select('id, user_id, type, title, body')
      .eq('id', notificationId)
      .single()

    if (notifErr || !notif) {
      return jsonResponse({ ok: true, skipped: 'notification not found (may have been deleted already)' })
    }

    if (notif.type === 'ride_requested') {
      return jsonResponse({ ok: true, skipped: 'ride_requested is emailed separately by notify-neighbors' })
    }

    const { data: recipient, error: recipientErr } = await supabaseAdmin
      .from('profiles')
      .select('email, email_notifications_enabled')
      .eq('id', notif.user_id)
      .single()

    if (recipientErr || !recipient) {
      return jsonResponse({ ok: true, skipped: 'recipient profile not found' })
    }

    if (recipient.email_notifications_enabled === false) {
      return jsonResponse({ ok: true, sent: false, reason: 'opted out of email notifications' })
    }

    const html = `<p>${notif.body}</p><p><a href="${APP_URL}">Open the app</a></p>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: recipient.email, subject: notif.title, html })
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('Resend error', res.status, errText)
      return jsonResponse({ ok: false, error: `${res.status} ${errText}` }, 500)
    }

    return jsonResponse({ ok: true, sent: true })
  } catch (err) {
    console.error(err)
    return jsonResponse({ ok: false, error: String(err) }, 500)
  }
})
