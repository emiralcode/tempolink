import { FileWarning } from 'lucide-react';
import { TransferRecord } from '../types';
import { formatBytes } from '../lib/format';

interface ConfirmTransferModalProps {
  transfer: TransferRecord;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}

export function ConfirmTransferModal({ transfer, onAccept, onReject }: ConfirmTransferModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl animate-fade-in">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/10 ring-1 ring-brand-400/30">
          <FileWarning className="h-6 w-6 text-brand-400" />
        </div>
        <h3 className="mt-4 text-center text-base font-semibold text-white">Gelen Dosya Talebi</h3>
        <p className="mt-2 text-center text-sm text-slate-400">
          <span className="font-medium text-slate-200">{formatBytes(transfer.size)}</span> boyutundaki{' '}
          <span className="break-all font-medium text-slate-200">"{transfer.name}"</span> dosyasını kabul ediyor musunuz?
        </p>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => onReject(transfer.id)}
            className="flex-1 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-red-400 hover:text-red-400"
          >
            Reddet
          </button>
          <button
            type="button"
            onClick={() => onAccept(transfer.id)}
            className="flex-1 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
          >
            Kabul Et
          </button>
        </div>
      </div>
    </div>
  );
}
