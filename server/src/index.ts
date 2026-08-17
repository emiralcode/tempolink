import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server, Socket } from 'socket.io';
import { connectRedis, disconnectRedis, redis, redisSubscriber } from './redis';
import { roomIdFromExpiredKey } from './redisKeys';
import { RoomManager, Room } from './roomManager';
import { JoinAttemptLimiter } from './joinAttemptLimiter';
import { AuditLog } from './auditLog';
import {
  ALLOWED_DURATIONS_MINUTES,
  ClientToServerEvents,
  CreateRoomPayload,
  JoinRoomPayload,
  MAX_FILE_SIZE_BYTES,
  ServerToClientEvents,
  SignalPayload,
  TransferEventPayload,
} from './types';

const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
const TIME_SYNC_INTERVAL_MS = 30_000;
const MAX_AUDIT_FILENAME_LENGTH = 300;

const app = express();
app.use(helmet());
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/api/health', async (_req, res) => {
  try {
    await redis.ping();
    res.json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()), redis: 'connected' });
  } catch {
    res.status(503).json({ status: 'degraded', redis: 'disconnected' });
  }
});

// Public, aggregate-only counters — never per-room detail, which would leak other
// users' file names/sizes to anyone hitting the endpoint.
app.get('/api/stats', async (_req, res) => {
  try {
    const [activeRooms, totalRoomsCreated] = await Promise.all([
      roomManager.getActiveRoomCount(),
      roomManager.getTotalRoomsCreated(),
    ]);
    res.json({ activeRooms, totalRoomsCreated, uptimeSeconds: Math.floor(process.uptime()) });
  } catch (err) {
    res.status(503).json({ error: 'Veritabanına ulaşılamıyor.' });
  }
});

const httpServer = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e5, // signaling payloads only — files never flow through the server
});

const timeSyncIntervals = new Map<string, NodeJS.Timeout>();

function startTimeSync(room: Room): void {
  stopTimeSync(room.id);
  const interval = setInterval(() => {
    io.to(room.id).emit('time-sync', { expiresAt: room.expiresAt, now: Date.now() });
  }, TIME_SYNC_INTERVAL_MS);
  timeSyncIntervals.set(room.id, interval);
}

function stopTimeSync(roomId: string): void {
  const interval = timeSyncIntervals.get(roomId);
  if (interval) {
    clearInterval(interval);
    timeSyncIntervals.delete(roomId);
  }
}

const roomManager = new RoomManager(redis);
const joinLimiter = new JoinAttemptLimiter(redis);
const auditLog = new AuditLog(redis);

function minutesToDuration(minutes: number): number | null {
  if (!ALLOWED_DURATIONS_MINUTES.includes(minutes as (typeof ALLOWED_DURATIONS_MINUTES)[number])) {
    return null;
  }
  return minutes * 60_000;
}

// Redis's own key expiry is the authoritative self-destruct trigger: when `room:{id}`
// times out, Redis publishes an 'expired' keyspace event and this handler tears the
// room down. This removes any possibility of drift between a stored expiresAt and a
// separately-tracked JS timer — there is exactly one clock, Redis's.
redisSubscriber.on('pmessage', (_pattern, _channel, expiredKey: string) => {
  const roomId = roomIdFromExpiredKey(expiredKey);
  if (!roomId) return;
  void handleRoomExpired(roomId);
});

async function handleRoomExpired(roomId: string): Promise<void> {
  await roomManager.cleanupExpiredRoomId(roomId);
  await auditLog.record({ kind: 'room_expired', roomId });
  io.to(roomId).emit('room-expired', { reason: 'timeout' });
  stopTimeSync(roomId);
  io.socketsLeave(roomId);
}

io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  socket.on('create-room', (payload: CreateRoomPayload, callback) => {
    void (async () => {
      const durationMs = minutesToDuration(payload?.durationMinutes);
      if (durationMs === null) {
        callback({ ok: false, error: 'Geçersiz süre seçimi.' });
        return;
      }

      try {
        const room = await roomManager.createRoom(durationMs);
        const joinResult = await roomManager.joinRoom({ roomId: room.id, token: room.token }, socket.id);

        if (!joinResult.ok) {
          callback({ ok: false, error: joinResult.error });
          return;
        }

        void socket.join(room.id);
        startTimeSync(room);
        await auditLog.record({ kind: 'room_created', roomId: room.id, durationMs: room.durationMs });

        callback({
          ok: true,
          roomId: room.id,
          roomToken: room.token,
          shortCode: room.shortCode,
          expiresAt: room.expiresAt,
          durationMs: room.durationMs,
        });
      } catch (err) {
        console.error('create-room hatası:', err);
        callback({ ok: false, error: 'Sunucu hatası, lütfen tekrar deneyin.' });
      }
    })();
  });

  socket.on('join-room', (payload: JoinRoomPayload, callback) => {
    void (async () => {
      const trimmedCode = payload?.shortCode?.trim();

      try {
        const result = await roomManager.joinRoom(
          { roomId: payload?.roomId, shortCode: trimmedCode, token: payload?.roomToken },
          socket.id
        );

        if (!result.ok) {
          // Only count failures against the shortCode brute-force limiter — link/token
          // based joins are not guessable in a meaningful number of attempts.
          if (trimmedCode) {
            const { exceeded } = await joinLimiter.registerFailure(socket.id);
            if (exceeded) {
              socket.emit('room-expired', { reason: 'closed' });
              socket.disconnect(true);
              return;
            }
          }
          callback({ ok: false, error: result.error });
          return;
        }

        await joinLimiter.clear(socket.id);
        void socket.join(result.room.id);

        callback({
          ok: true,
          roomId: result.room.id,
          isInitiator: result.isInitiator,
          expiresAt: result.room.expiresAt,
          peerPresent: result.peerPresent,
        });

        if (result.peerPresent) {
          socket.to(result.room.id).emit('peer-joined');
          await auditLog.record({ kind: 'peer_joined', roomId: result.room.id });
        }
      } catch (err) {
        console.error('join-room hatası:', err);
        callback({ ok: false, error: 'Sunucu hatası, lütfen tekrar deneyin.' });
      }
    })();
  });

  socket.on('signal', (payload: SignalPayload) => {
    void (async () => {
      const roomId = await roomManager.getRoomIdForSocket(socket.id);
      if (!roomId || roomId !== payload.roomId) return;
      socket.to(roomId).emit('signal', { from: socket.id, data: payload.data });
    })();
  });

  socket.on('transfer-event', (payload: TransferEventPayload) => {
    void (async () => {
      try {
        const roomId = await roomManager.getRoomIdForSocket(socket.id);
        if (!roomId || roomId !== payload.roomId) return; // ignore spoofed/stale events
        if (!Number.isFinite(payload.fileSize) || payload.fileSize < 0 || payload.fileSize > MAX_FILE_SIZE_BYTES) {
          return;
        }

        await auditLog.record({
          kind: `transfer_${payload.event}`,
          roomId,
          transferId: payload.transferId,
          direction: payload.direction,
          fileName: String(payload.fileName ?? '').slice(0, MAX_AUDIT_FILENAME_LENGTH),
          fileSize: payload.fileSize,
          errorMessage: payload.errorMessage?.slice(0, MAX_AUDIT_FILENAME_LENGTH),
        });
      } catch (err) {
        console.error('transfer-event denetim kaydı hatası:', err);
      }
    })();
  });

  socket.on('leave-room', () => {
    void handleDisconnect(socket.id);
  });

  socket.on('disconnect', () => {
    void handleDisconnect(socket.id);
    void joinLimiter.clear(socket.id);
  });
});

async function handleDisconnect(socketId: string): Promise<void> {
  try {
    const result = await roomManager.leaveRoom(socketId);
    if (!result.roomId) return;

    if (result.destroyed) {
      stopTimeSync(result.roomId);
      await auditLog.record({ kind: 'room_closed', roomId: result.roomId });
    } else if (result.remainingSocketId) {
      io.to(result.remainingSocketId).emit('peer-disconnected');
      await auditLog.record({ kind: 'peer_left', roomId: result.roomId });
    }
  } catch (err) {
    console.error('bağlantı kesme işleme hatası:', err);
  }
}

async function main(): Promise<void> {
  await connectRedis();

  httpServer.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Signaling server listening on port ${PORT} (client origin: ${CLIENT_ORIGIN})`);
  });
}

main().catch((err) => {
  console.error('Sunucu başlatılamadı:', err);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  for (const interval of timeSyncIntervals.values()) clearInterval(interval);
  await disconnectRedis();
  httpServer.close(() => process.exit(0));
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
