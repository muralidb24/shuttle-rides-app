import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import { getProfile, createProfile } from './lib/api'
import type { Profile } from './types'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import RequestRide from './pages/RequestRide'
import WelcomeName from './pages/WelcomeName'

type View = 'dashboard' | 'request'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileChecked, setProfileChecked] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setProfileChecked(false)
      return
    }
    setProfileChecked(false)
    getProfile(session.user.id).then((p) => {
      setProfile(p)
      setProfileChecked(true)
    })
  }, [session])

  if (loading) return null
  if (!session) return <Login />
  if (!profileChecked) return null

  if (!profile) {
    return (
      <WelcomeName
        onSubmit={async (name) => {
          const created = await createProfile(session.user, name)
          setProfile(created)
        }}
      />
    )
  }

  if (view === 'request') {
    return (
      <RequestRide
        userId={profile.id}
        onCreated={() => setView('dashboard')}
        onCancel={() => setView('dashboard')}
      />
    )
  }

  return <Dashboard profile={profile} onRequestRide={() => setView('request')} onProfileChange={setProfile} />
}
