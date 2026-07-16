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
  if (!Capacitor.isNativePlatform()) return
  const plat = platform()
  if (!plat) return

  if (!listenersAttached) {
    listenersAttached = true

    PushNotifications.addListener('registration', (token: Token) => {
      currentToken = token.value
      registerPushToken(userId, token.value, plat).catch((err) => {
        console.error('Failed to register push token', err)
      })
    })

    PushNotifications.addListener('registrationError', (err) => {
      console.error('Push registration error', err)
    })

    // Foreground notifications: the OS doesn't show a banner automatically
    // while the app is open, so there's nothing to do here yet beyond
    // logging - the in-app notification bell (already backed by Supabase
    // Realtime) is what covers the foreground case today.
    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      console.log('Push received in foreground', notification)
    })

    // User tapped a notification (app was backgrounded/closed). Nothing
    // beyond bringing the app forward is needed - the dashboard already
    // loads the current notification list on mount.
    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      console.log('Push notification tapped', action.notification)
    })
  }

  let permStatus = await PushNotifications.checkPermissions()
  if (permStatus.receive === 'prompt') {
    permStatus = await PushNotifications.requestPermissions()
  }
  if (permStatus.receive !== 'granted') return

  await PushNotifications.register()
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
