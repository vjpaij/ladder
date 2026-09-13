import React, { useState } from 'react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';
import logoImg from '../assets/logo.png';

export default function LoginView() {
  const { login } = useThemeAuth();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isRegistering = mode === 'register';

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isRegistering && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const endpoint = `/api/auth/${isRegistering ? 'register' : 'login'}`;
      const payload = isRegistering ? { name: name.trim(), email, password } : { email, password };
      const response = await axios.post(endpoint, payload);
      login(response.data.token, response.data.user);
    } catch (err) {
      if (!err.response) {
        setError('Unable to connect to server. Please verify the backend is running.');
      } else {
        setError(err.response?.data?.error || 'Authentication failed. Please check your credentials.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07080d] text-slate-100 flex items-center justify-center p-4 sm:p-6 overflow-hidden relative">
      <div className="absolute -top-48 -right-32 w-[32rem] h-[32rem] rounded-full bg-fuchsia-600/10 blur-3xl" />
      <div className="absolute -bottom-56 -left-32 w-[32rem] h-[32rem] rounded-full bg-amber-500/10 blur-3xl" />
      <div className="relative w-full max-w-5xl min-h-[580px] grid lg:grid-cols-[1.08fr_0.92fr] overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/50 backdrop-blur-xl">
        <section className="hidden lg:flex relative flex-col justify-between p-10 xl:p-14 overflow-hidden bg-gradient-to-br from-[#171329] via-[#21132a] to-[#5a1f2c]">
          <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_20%_20%,rgba(168,85,247,0.8),transparent_35%),radial-gradient(circle_at_85%_75%,rgba(251,146,60,0.55),transparent_32%)]" />
          <div className="relative z-10 flex items-center gap-3">
            <span className="text-2xl font-black tracking-[0.3em]">LADDER</span>
          </div>
          <div className="relative z-10 flex flex-col items-center justify-center flex-1 my-auto">
            <img
              src={logoImg}
              alt="Ladder Dashboard"
              className="w-[min(24rem,80%)] aspect-[628/500] object-cover rounded-[2rem] drop-shadow-[0_28px_45px_rgba(0,0,0,0.42)]"
            />
          </div>
          <div className="relative z-10 flex items-center gap-3 text-xs text-white/50">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.8)]" />
            Active Session
          </div>
        </section>

        <section className="flex flex-col justify-center p-7 sm:p-10 xl:p-14 bg-[#0c0e15]/90">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <img src={logoImg} alt="Ladder" className="w-12 h-12 rounded-2xl object-cover" />
            <div className="font-black tracking-[0.28em] text-lg">LADDER</div>
          </div>
          <div className="max-w-md w-full mx-auto">
            <div className="mb-6">
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight">{isRegistering ? 'Register' : 'Sign in'}</h2>
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-white/[0.06] border border-white/[0.06] mb-6">
              {['login', 'register'].map(option => (
                <button
                  key={option}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => { setMode(option); setError(''); }}
                  className={`py-2.5 rounded-lg text-xs font-bold transition-colors ${
                    mode === option ? 'bg-white/10 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {option === 'login' ? 'Sign in' : 'Register'}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3.5 py-3 text-sm text-rose-200">
                  {error}
                </div>
              )}

              {isRegistering && (
                <input
                  required
                  disabled={isSubmitting}
                  minLength={2}
                  maxLength={80}
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-xl bg-white/[0.045] border border-white/10 px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-400/70 focus:bg-white/[0.07] disabled:opacity-50"
                />
              )}

              <input
                required
                disabled={isSubmitting}
                type="email"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email address"
                className="w-full rounded-xl bg-white/[0.045] border border-white/10 px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-400/70 focus:bg-white/[0.07] disabled:opacity-50"
              />

              <input
                required
                disabled={isSubmitting}
                minLength={8}
                maxLength={128}
                type="password"
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full rounded-xl bg-white/[0.045] border border-white/10 px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-400/70 focus:bg-white/[0.07] disabled:opacity-50"
              />

              {isRegistering && (
                <input
                  required
                  disabled={isSubmitting}
                  minLength={8}
                  maxLength={128}
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  className="w-full rounded-xl bg-white/[0.045] border border-white/10 px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-400/70 focus:bg-white/[0.07] disabled:opacity-50"
                />
              )}

              <button
                disabled={isSubmitting}
                type="submit"
                className="w-full rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-300 hover:to-teal-400 text-slate-950 font-black py-3 text-sm shadow-lg shadow-emerald-500/15 transition-all disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (isRegistering ? 'Creating workspace...' : 'Signing in...') : (isRegistering ? 'Create account' : 'Enter Ladder')}
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
