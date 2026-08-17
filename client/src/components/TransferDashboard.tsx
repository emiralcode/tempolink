import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  CheckCircle2,
  CloudUpload,
  Download,
  Loader2,
  Send,
  Wifi,
  X,
  XCircle,
} from 'lucide-react';
import { useWebRTC } from '../hooks/useWebRTC';
import { useCountdown } from '../hooks/useCountdown';
import { ClientToServerEvents, ServerToClientEvents, TransferRecord, TransferStatus } from '../types';
import { formatBytes, formatSpeed } from '../lib/format';
import { ConfirmTransferModal } from './ConfirmTransferModal';

interface TransferDashboardProps {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  roomId: string;
  isInitiator: boolean;
  expiresAt: number;
  createdAt: number;
  onExpired: () => void;
}

const STATUS_LABEL: Record<TransferStatus, string> = {
  'awaiting-approval': 'Onay bekleniyor…',
  'pending-approval': 'Onayınız bekleniyor…',
  transferring: 'Aktarılıyor…',
  completed: 'Tamamlandı',
  rejected: 'Reddedildi',
  cancelled: 'İptal edildi',
  error: 'Hata',
};

export function TransferDashboard({ socket, roomId, isInitiator, expiresAt, createdAt, onExpired }: TransferDashboardProps) {
  const {
    connectionState,
    channelState,
    transfers,
    messages,
    incomingRequest,
    sendFiles,
    sendText,
    acceptTransfer,
    rejectTransfer,
    cancelTransfer,
  } = useWebRTC({ socket, roomId, isInitiator, enabled: true });

  const { formatted, isUrgent, isExpired } = useCountdown(expiresAt, createdAt);
  const [isDragActive, setIsDragActive] = useState(false);
  const [textInput, setTextInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isExpired) onExpired();
  }, [isExpired, onExpired]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    if (event.dataTransfer.files.length) sendFiles(event.dataTransfer.files);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) sendFiles(event.target.files);
    event.target.value = '';
  }

  function handleTextSubmit(event: FormEvent) {
    event.preventDefault();
    if (!textInput.trim()) return;
    sendText(textInput);
    setTextInput('');
  }

  const isPeerConnected = connectionState === 'connected' && channelState === 'open';

  return (
    <div className="min-h-screen px-4 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <header className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-3">
          <div className="flex items-center gap-2">
            {isPeerConnected ? (
              <Wifi className="h-4 w-4 text-emerald-400" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
            )}
            <span className="text-sm text-slate-300">
              {isPeerConnected ? 'P2P bağlantı kuruldu' : 'Bağlantı kuruluyor…'}
            </span>
          </div>
          <div
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold tabular-nums ${
              isUrgent ? 'border-red-500/50 text-red-400 animate-alarm-pulse' : 'border-slate-800 text-slate-300'
            }`}
          >
            {formatted}
          </div>
        </header>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragActive(true);
          }}
          onDragLeave={() => setIsDragActive(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            isDragActive ? 'border-brand-400 bg-brand-500/5' : 'border-slate-800 bg-slate-900/40'
          }`}
        >
          <CloudUpload className={`h-8 w-8 ${isDragActive ? 'text-brand-400' : 'text-slate-500'}`} />
          <p className="text-sm text-slate-300">Dosyaları buraya sürükleyin veya</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
          >
            Dosya Seç
          </button>
          <p className="text-xs text-slate-500">Maksimum dosya boyutu 100 MB</p>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />
        </div>

        {transfers.length > 0 && (
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <h3 className="px-1 text-xs font-medium uppercase tracking-wider text-slate-500">Aktarımlar</h3>
            <ul className="space-y-2">
              {transfers.map((transfer) => (
                <TransferRow key={transfer.id} transfer={transfer} onCancel={cancelTransfer} />
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-1 flex-col rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="px-1 pb-2 text-xs font-medium uppercase tracking-wider text-slate-500">Mesajlar</h3>
          <div className="flex max-h-72 min-h-[6rem] flex-col gap-2 overflow-y-auto px-1 py-2">
            {messages.length === 0 && <p className="text-sm text-slate-600">Henüz mesaj yok.</p>}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                  message.direction === 'send'
                    ? 'ml-auto rounded-br-sm bg-brand-500 text-white'
                    : 'mr-auto rounded-bl-sm bg-slate-800 text-slate-100'
                }`}
              >
                {message.text}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={handleTextSubmit} className="mt-2 flex gap-2">
            <input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              maxLength={5000}
              placeholder="Bir mesaj yazın…"
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-brand-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!isPeerConnected || !textInput.trim()}
              className="shrink-0 rounded-xl bg-slate-800 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>

      {incomingRequest && (
        <ConfirmTransferModal transfer={incomingRequest} onAccept={acceptTransfer} onReject={rejectTransfer} />
      )}
    </div>
  );
}

function TransferRow({ transfer, onCancel }: { transfer: TransferRecord; onCancel: (id: string) => void }) {
  const percent = transfer.size > 0 ? Math.min(100, Math.round((transfer.progressBytes / transfer.size) * 100)) : 0;
  const isActive = transfer.status === 'transferring' || transfer.status === 'awaiting-approval';

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-200">{transfer.name}</p>
          <p className="text-xs text-slate-500">
            {transfer.direction === 'send' ? 'Gönderiliyor' : 'Alınıyor'} · {formatBytes(transfer.size)}
            {transfer.status === 'transferring' && ` · ${formatSpeed(transfer.speedBytesPerSec)}`}
          </p>
        </div>
        <StatusBadge status={transfer.status} />
      </div>

      {transfer.status !== 'error' && transfer.status !== 'rejected' && transfer.status !== 'cancelled' && (
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full transition-all duration-150 ${
              transfer.status === 'completed' ? 'bg-emerald-500' : 'bg-brand-500'
            }`}
            style={{ width: `${transfer.status === 'awaiting-approval' ? 0 : percent}%` }}
          />
        </div>
      )}

      {transfer.errorMessage && <p className="mt-1.5 text-xs text-red-400">{transfer.errorMessage}</p>}

      <div className="mt-2 flex items-center gap-3">
        {transfer.status === 'completed' && transfer.direction === 'receive' && transfer.blobUrl && (
          <a
            href={transfer.blobUrl}
            download={transfer.name}
            className="flex items-center gap-1.5 text-xs font-medium text-brand-400 hover:text-brand-300"
          >
            <Download className="h-3.5 w-3.5" />
            İndir
          </a>
        )}
        {isActive && (
          <button
            type="button"
            onClick={() => onCancel(transfer.id)}
            className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-400"
          >
            <X className="h-3.5 w-3.5" />
            İptal
          </button>
        )}
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: TransferStatus }) {
  const label = STATUS_LABEL[status];
  if (status === 'completed') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {label}
      </span>
    );
  }
  if (status === 'rejected' || status === 'error' || status === 'cancelled') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-red-400">
        <XCircle className="h-3.5 w-3.5" />
        {label}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-slate-400">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {label}
    </span>
  );
}
