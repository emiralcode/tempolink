import { LockKeyhole, RotateCcw } from 'lucide-react';

interface LockScreenProps {
  title: string;
  subtitle: string;
  onReset: () => void;
}

export function LockScreen({ title, subtitle, onReset }: LockScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm animate-fade-in space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 ring-1 ring-red-500/40">
          <LockKeyhole className="h-8 w-8 text-red-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <p className="text-sm text-slate-400">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="mx-auto flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
        >
          <RotateCcw className="h-4 w-4" />
          Yeni Oda Oluştur
        </button>
      </div>
    </div>
  );
}
