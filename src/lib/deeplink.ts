// Handles the magic-link sign-in redirect on native platforms.
//
// Capacitor apps load their web content from a private local address (not
// the app's real https:// URL), so the OS has no built-in way to connect a
// link in an email back to this specific app. To make that connection, the
// native iOS/Android projects register a custom URL scheme ("shuttlerides")
// - see ios/App/App/Info.plist and android/app/src/main/AndroidManifest.xml
// - and Login.tsx asks Supabase to redirect there instead of to the website
// when running natively.
//
// When the user taps that link, the OS reopens this app and fires an
// 'appUrlOpen' event with the full URL instead of navigating like a normal
// page load - so unlike the web version (where supabase-js's
// `detectSessionInUrl` picks the tokens up automatically on page load), we
// have to parse the incoming URL ourselves and hand the tokens to
// supabase-js directly.
//
// Supabase's default auth flow ("implicit") puts the tokens in the URL
// fragment, e.g. shuttlerides://login-callback#access_token=...&refresh_token=...

import { Capacitor } from '@capacitor/core'
import { App, type URLOpenListenerEvent } from '@capacitor/app'
import { supabase } from '../supabaseClient'

let listenerAttached = false

async function handleUrl(url: string): Promise<void> {
  const hashIndex = url.indexOf('#')
  if (hashIndex === -1) return

  const params = new URLSearchParams(url.slice(hashIndex + 1))
  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  if (!access_token || !refresh_token) return

  const { error } = await supabase.auth.setSession({ access_token, refresh_token })
  if (error) {
    console.error('Failed to complete native sign-in from deep link', error)
  }
}

export function initDeepLinks(): void {
  if (!Capacitor.isNativePlatform()) return
  if (listenerAttached) return
  listenerAttached = true

  App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    handleUrl(event.url).catch((err) => {
      console.error('Error handling deep link', err)
    })
  })
}
