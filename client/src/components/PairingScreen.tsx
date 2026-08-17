import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Loader2, XCircle } from 'lucide-react';
import { useCountdown } from '../hooks/useCountdown';

interface PairingScreenProps {
  roomLink: string;
  shortCode: string;
  expiresAt: number;
  createdAt: number;
  onCancel: () => void;
}

export function PairingScreen({ roomLink, shortCode, expiresAt, createdAt, onCancel }: PairingScreenProps) {
  const [copied, setCopied] = useState(false);
  const { formatted, isUrgent } = useCountdown(expiresAt, createdAt);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(roomLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6 animate-fade-in text-center">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl shadow-black/20 space-y-6">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-brand-400" />
            <p className="text-sm text-slate-300">Karşı taraf bekleniyor…</p>
          </div>

          <div className="mx-auto flex w-fit items-center justify-center rounded-xl bg-white p-4">
            <QRCodeSVG value={roomLink} size={200} />
          </div>

          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">Oda Kodu</p>
            <p className="mt-1 text-4xl font-bold tracking-[0.3em] text-white">{shortCode}</p>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-brand-400"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Bağlantı kopyalandı' : 'Bağlantıyı kopyala'}
          </button>

          <div className={`rounded-xl border px-4 py-2 text-sm font-medium ${isUrgent ? 'border-red-500/50 text-red-400 animate-alarm-pulse' : 'border-slate-800 text-slate-400'}`}>
            Oda süresi: <span className="tabular-nums">{formatted}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="flex w-full items-center justify-center gap-2 text-sm text-slate-500 transition-colors hover:text-slate-300"
        >
          <XCircle className="h-4 w-4" />
          Vazgeç ve odayı kapat
        </button>
      </div>
    </div>
  );
}
