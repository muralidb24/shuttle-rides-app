import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.postalcolony.shuttlerides',
  appName: 'Ride, please!',
  webDir: 'dist',
  // Capacitor only makes the web view inspectable via Safari's Web
  // Inspector by default in Debug builds. Our TestFlight builds are
  // Release builds, so without this flag Safari shows "No inspectable
  // applications" even with Web Inspector enabled on both the phone and
  // the Mac. Safe to leave on while we're still in private beta testing.
  ios: {
    webContentsDebuggingEnabled: true
  }
}

export default config
