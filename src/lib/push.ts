// Native push notification wiring (Capacitor). This is a no-op on the web
// build - Capacitor.isNativePlatform() is false there, so none of this runs
// and the plain browser app is unaffected. Only takes effect once the app is
// running inside the iOS/Android shells built in supabase/../capacitor.config.ts.
//
// Requires the Firebase config files to be present in the native projects
// (android/app/google-services.json, ios/App/App/GoogleService-Info.plist)
// and FIREBASE_SERVICE_ACCOUNT_JSON set on the send-push edge function - see
// supabase/functions/send-push/index.ts for the server side of this.

import { Capacitor } from '@capacitor/core'
import { PushNotifications, type Token, type PushNotificationSchema, type ActionPerformed } from '@capacitor/push-notifications'
import { registerPushToken, unregisterPushToken } from './api'

// Cached so sign-out can unregister the same token without the plugin
// exposing a "getCurrentToken" lookup of its own.
let currentToken: string | null = null
let listenersAttached = false

function platform(): 'ios' | 'android' | null {
  const p = Capacitor.getPlatform()
  return p === 'ios' || p === 'android' ? p : null
}

export async function initPushNotifications(userId: string): Promise<void> {
  console.log('[push] initPushNotifications called for user', userId)

  if (!Capacitor.isNativePlatform()) {
    console.log('[push] not a native platform, skipping')
    return
  }
  const plat = platform()
  if (!plat) {
    console.log('[push] unrecognized platform, skipping:', Capacitor.getPlatform())
    return
  }
  console.log('[push] running on', plat)

  if (!listenersAttached) {
    listenersAttached = true
    console.log('[push] attaching listeners')

    PushNotifications.addListener('registration', (token: Token) => {
      console.log('[push] registration event received, token starts with', token.value.slice(0, 12))
      currentToken = token.value
      registerPushToken(userId, token.value, plat)
        .then(() => console.log('[push] registerPushToken saved to database successfully'))
        .catch((err) => {
          console.error('[push] Failed to register push token', err)
        })
    })

    PushNotifications.addListener('registrationError', (err) => {
      console.error('[push] Push registration error', JSON.stringify(err))
    })

    // Foreground notifications: the OS doesn't show a banner automatically
    // while the app is open, so there's nothing to do here yet beyond
    // logging - the in-app notification bell (already backed by Supabase
    // Realtime) is what covers the foreground case today.
    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      console.log('[push] Push received in foreground', notification)
    })

    // User tapped a notification (app was backgrounded/closed). Nothing
    // beyond bringing the app forward is needed - the dashboard already
    // loads the current notification list on mount.
    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      console.log('[push] Push notification tapped', action.notification)
    })
  } else {
    console.log('[push] listeners already attached from a previous call')
  }

  try {
    let permStatus = await PushNotifications.checkPermissions()
    console.log('[push] checkPermissions result:', permStatus.receive)
    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions()
      console.log('[push] requestPermissions result:', permStatus.receive)
    }
    if (permStatus.receive !== 'granted') {
      console.log('[push] permission not granted, stopping before register():', permStatus.receive)
      return
    }

    console.log('[push] calling PushNotifications.register()')
    await PushNotifications.register()
    console.log('[push] register() call completed without throwing (waiting for registration event)')
  } catch (err) {
    console.error('[push] Unexpected error during permission/register flow', err)
  }
}

export async function clearPushToken(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  if (!currentToken) return
  try {
    await unregisterPushToken(currentToken)
  } catch (err) {
    console.error('Failed to unregister push token', err)
  } finally {
    currentToken = null
  }
}
