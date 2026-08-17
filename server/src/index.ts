import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server, Socket } from 'socket.io';
import { RoomManager, Room } from './roomManager';
import { JoinAttemptLimiter } from './joinAttemptLimiter';
import {
  ALLOWED_DURATIONS_MINUTES,
  ClientToServerEvents,
  CreateRoomPayload,
  JoinRoomPayload,
  ServerToClientEvents,
  SignalPayload,
} from './types';

const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
const TIME_SYNC_INTERVAL_MS = 30_000;

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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

const httpServer = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e5, // signaling payloads only — files never flow through the server
});

const timeSyncIntervals = new Map<string, NodeJS.Timeout>();

function broadcastRoomExpired(room: Room): void {
  io.to(room.id).emit('room-expired', { reason: 'timeout' });
  stopTimeSync(room.id);
  io.socketsLeave(room.id);
}

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

const roomManager = new RoomManager({ onRoomExpired: broadcastRoomExpired });
const joinLimiter = new JoinAttemptLimiter();

function minutesToDuration(minutes: number): number | null {
  if (!ALLOWED_DURATIONS_MINUTES.includes(minutes as (typeof ALLOWED_DURATIONS_MINUTES)[number])) {
    return null;
  }
  return minutes * 60_000;
}

io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  socket.on('create-room', (payload: CreateRoomPayload, callback) => {
    const durationMs = minutesToDuration(payload?.durationMinutes);
    if (durationMs === null) {
      callback({ ok: false, error: 'Geçersiz süre seçimi.' });
      return;
    }

    const room = roomManager.createRoom(durationMs);
    const joinResult = roomManager.joinRoom({ roomId: room.id, token: room.token }, socket.id);

    if (!joinResult.ok) {
      callback({ ok: false, error: joinResult.error });
      return;
    }

    void socket.join(room.id);
    startTimeSync(room);

    callback({
      ok: true,
      roomId: room.id,
      roomToken: room.token,
      shortCode: room.shortCode,
      expiresAt: room.expiresAt,
      durationMs: room.durationMs,
    });
  });

  socket.on('join-room', (payload: JoinRoomPayload, callback) => {
    const trimmedCode = payload?.shortCode?.trim();

    const result = roomManager.joinRoom(
      { roomId: payload?.roomId, shortCode: trimmedCode, token: payload?.roomToken },
      socket.id
    );

    if (!result.ok) {
      // Only count failures against the shortCode brute-force limiter — link/token
      // based joins are not guessable in a meaningful number of attempts.
      if (trimmedCode) {
        const { exceeded } = joinLimiter.registerFailure(socket.id);
        if (exceeded) {
          socket.emit('room-expired', { reason: 'closed' });
          socket.disconnect(true);
          return;
        }
      }
      callback({ ok: false, error: result.error });
      return;
    }

    joinLimiter.clear(socket.id);
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
    }
  });

  socket.on('signal', (payload: SignalPayload) => {
    const roomId = roomManager.getRoomIdForSocket(socket.id);
    if (!roomId || roomId !== payload.roomId) return;
    socket.to(roomId).emit('signal', { from: socket.id, data: payload.data });
  });

  socket.on('leave-room', () => {
    handleDisconnect(socket.id);
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket.id);
    joinLimiter.clear(socket.id);
  });
});

function handleDisconnect(socketId: string): void {
  const result = roomManager.leaveRoom(socketId);
  if (!result.roomId) return;

  if (result.destroyed) {
    stopTimeSync(result.roomId);
  } else if (result.remainingSocketId) {
    io.to(result.remainingSocketId).emit('peer-disconnected');
  }
}

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Signaling server listening on port ${PORT} (client origin: ${CLIENT_ORIGIN})`);
});

process.on('SIGTERM', () => {
  roomManager.shutdown();
  httpServer.close(() => process.exit(0));
});
