import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

function createClient(label: string): Redis {
  const client = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
  });

  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`[redis:${label}] hata:`, err.message);
  });
  client.on('reconnecting', () => {
    // eslint-disable-next-line no-console
    console.warn(`[redis:${label}] yeniden bağlanılıyor…`);
  });

  return client;
}

// Primary client for room/session state, rate limiting, and audit-log writes.
export const redis = createClient('main');

// Redis requires a dedicated connection once it enters subscribe mode — it can no
// longer run ordinary commands on that connection — so key-expiry notifications
// (which drive the self-destruct mechanism) are consumed on a separate client.
export const redisSubscriber = createClient('subscriber');

export async function connectRedis(): Promise<void> {
  await Promise.all([redis.connect(), redisSubscriber.connect()]);

  // 'Ex' = keyspace notifications for generic commands + expired events. This turns
  // Redis's native TTL into the authoritative self-destruct timer: when a `room:{id}`
  // key expires, Redis itself publishes the event that tears the room down (see the
  // psubscribe handler wired up in index.ts).
  await redis.config('SET', 'notify-keyspace-events', 'Ex');
  await redisSubscriber.psubscribe('__keyevent@*__:expired');

  // eslint-disable-next-line no-console
  console.log(`[redis] bağlantı kuruldu (${REDIS_URL})`);
}

export async function disconnectRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), redisSubscriber.quit()]);
}
