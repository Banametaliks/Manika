import { useState } from 'react'
import { supabase } from '../data/store'
import icon from '../assets/icon.svg'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-brand-900 px-6">
      <img src={icon} alt="" className="mb-4 h-16 w-16 rounded-2xl" />
      <h1 className="mb-6 text-xl font-semibold text-white">Manika Exhibition</h1>
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3 p-5">
        <input className="input" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="text-center text-xs text-stone-500">Staff accounts are created by the admin in Supabase → Authentication → Users.</p>
      </form>
    </div>
  )
}
