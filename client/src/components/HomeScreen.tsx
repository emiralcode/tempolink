import { FormEvent, useState } from 'react';
import { ShieldCheck, Timer, Users, KeyRound, Loader2 } from 'lucide-react';
import { ALLOWED_DURATIONS, RoomDurationMinutes } from '../types';

interface HomeScreenProps {
  onCreateRoom: (duration: RoomDurationMinutes) => void;
  onJoinByCode: (code: string) => void;
  creating: boolean;
  joining: boolean;
  errorMessage: string | null;
}

export function HomeScreen({ onCreateRoom, onJoinByCode, creating, joining, errorMessage }: HomeScreenProps) {
  const [duration, setDuration] = useState<RoomDurationMinutes>(15);
  const [code, setCode] = useState('');

  function handleJoinSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length !== 6) return;
    onJoinByCode(trimmed);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl space-y-8 animate-fade-in">
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/10 ring-1 ring-brand-400/30">
            <ShieldCheck className="h-7 w-7 text-brand-400" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Tempolink</h1>
          <p className="text-sm text-slate-400">
            Zaman ayarlı, uçtan uca P2P paylaşım. Dosyalarınız sunucudan asla geçmez.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl shadow-black/20 space-y-5">
          <div className="flex items-center gap-2 text-slate-200">
            <Timer className="h-4 w-4 text-brand-400" />
            <h2 className="text-sm font-medium">Oda süresini seçin</h2>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ALLOWED_DURATIONS.map((option) => (
              <button
                key={option.minutes}
                type="button"
                onClick={() => setDuration(option.minutes)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  duration === option.minutes
                    ? 'border-brand-400 bg-brand-500/15 text-brand-300'
                    : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={creating}
            onClick={() => onCreateRoom(duration)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            {creating ? 'Oda oluşturuluyor…' : 'Oda Oluştur'}
          </button>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl shadow-black/20">
          <form onSubmit={handleJoinSubmit} className="space-y-3">
            <div className="flex items-center gap-2 text-slate-200">
              <KeyRound className="h-4 w-4 text-brand-400" />
              <h2 className="text-sm font-medium">6 haneli kodla katıl</h2>
            </div>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
                className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-center text-lg tracking-[0.4em] text-white placeholder:tracking-normal placeholder:text-slate-600 focus:border-brand-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={joining || code.length !== 6}
                className="shrink-0 rounded-xl bg-slate-800 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Katıl'}
              </button>
            </div>
          </form>
        </div>

        {errorMessage && (
          <p className="text-center text-sm text-red-400" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}
