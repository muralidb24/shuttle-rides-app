// Edge function: permanently deletes the calling user's own account.
//
// Only the auth.users row itself can be deleted via the Admin API (requires
// the service-role key, so this can't be done directly from the client) -
// but thanks to `profiles.id references auth.users(id) on delete cascade`
// (and the same cascade chain from there down through ride_requests,
// ride_offers, notifications, push_tokens, request_audience_members), that
// one deletion is enough to remove everything the user owns.
//
// The caller's identity always comes from their own JWT (via
// supabase.auth.getUser()), never from anything in the request body - that
// way this function can only ever delete the account making the call, not
// an id someone else supplies.
//
// Deploy: supabase functions deploy delete-account
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided
// automatically by Supabase.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Browsers send a CORS preflight (OPTIONS) before the actual POST whenever the
// call crosses origins - which it always does here, since the app is served
// from GitHub Pages and calls *.supabase.co. Without an explicit OPTIONS
// handler + CORS headers on every response, the preflight fails and the
// browser never sends the real request at all.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'missing authorization header' }, 401)
    }

    // Resolve who's actually calling from their own session token - this is
    // the only source of truth for whose account gets deleted.
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData?.user) {
      return json({ error: 'not authenticated' }, 401)
    }
    const userId = userData.user.id

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
    if (deleteError) {
      return json({ error: deleteError.message }, 500)
    }

    return json({ success: true })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'unknown error' }, 500)
  }
})
