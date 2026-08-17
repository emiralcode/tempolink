# SecureShare — Zaman Ayarlı ve Güvenli Web Paylaşım Portalı

> **Repo:** [github.com/emiralcode/secure-share](https://github.com/emiralcode/secure-share) (private)

Uçtan uca **WebRTC P2P** üzerinden, sunucudan hiçbir dosya baytının geçmediği, zaman ayarlı ve kendini imha eden bir dosya/metin paylaşım portalı. Oda durumu ve denetim (audit) kaydı **Redis**'te tutulur.

## Mimari

- `server/` — Node.js + TypeScript + Express + Socket.io. Sadece **sinyalleşme** (offer/answer/ICE) ve **oda yaşam döngüsü** yönetimini yapar. Hiçbir dosya baytı sunucuya uğramaz.
- `client/` — React + TypeScript + Tailwind CSS. WebRTC `RTCDataChannel` üzerinden ikili (binary) chunk aktarımı, geri basınç (backpressure) kontrolü, QR kod eşleşmesi ve senkronize geri sayım.
- **Redis** — oda durumu, kısa kod eşlemesi, join-attempt rate limiting ve denetim kaydının (audit log) veritabanı. Detay için [Neden Redis?](#neden-redis) bölümüne bakın.

```
tempdrop/
├── docker-compose.yml         # Redis servisi (AOF kalıcılık + keyspace notifications)
├── server/
│   └── src/
│       ├── index.ts              # Express + Socket.io giriş noktası, /api/stats
│       ├── redis.ts              # Redis bağlantıları + keyspace-notification aboneliği
│       ├── redisKeys.ts          # Merkezi Redis anahtar şeması
│       ├── roomManager.ts        # Oda CRUD'u (Redis üzerinde), self-destruct TTL
│       ├── joinAttemptLimiter.ts # 6 haneli kod için Redis tabanlı brute-force koruması
│       ├── auditLog.ts           # Metadata-only denetim kaydı (Redis liste)
│       └── types.ts              # Sinyalleşme sözleşmesi (paylaşılan tipler)
└── client/
    └── src/
        ├── hooks/
        │   ├── useWebRTC.ts      # P2P bağlantı, chunking, backpressure, transfer state machine
        │   └── useCountdown.ts   # Sunucu ile senkronize geri sayım
        ├── components/
        │   ├── HomeScreen.tsx
        │   ├── PairingScreen.tsx
        │   ├── TransferDashboard.tsx
        │   ├── ConfirmTransferModal.tsx
        │   └── LockScreen.tsx
        ├── lib/
        │   ├── socket.ts
        │   └── format.ts
        └── App.tsx
```

## Neden Redis?

Projenin kendi güvenlik gerekçesi açık: *"veriler sunucuda tutulmadığı için maksimum güvenlik sağlanır."* Bu yüzden **dosya/metin içeriği veritabanına asla girmez** — bu ilke değişmedi, P2P `RTCDataChannel` tek veri yolu olmaya devam ediyor.

Veritabanı katmanı bunun yerine **oturum durumunu ve metadata'yı** profesyonelce yönetmek için var:

- **Self-destruct = Redis TTL**: Her oda `EX <saniye>` ile yazılır. Zamanlayıcı artık uygulama kodunda ayrı bir `setTimeout` değil, doğrudan Redis'in kendisi — anahtar süresi dolunca Redis bir `expired` keyspace event'i yayınlar (`redis.ts`), sunucu buna abone olup odayı gerçek zamanlı kapatır (`index.ts`). Tek doğruluk kaynağı, sapma (drift) riski yok.
- **Kalıcılık**: Sunucu yeniden başlasa bile Redis AOF (`appendonly yes`) sayesinde aktif oda sayacı ve denetim kaydı kaybolmaz (canlı WebRTC oturumları yine de soket bağlantısına bağlı olduğundan yeniden başlatmada düşer — bu kaçınılmaz, DB'den bağımsız).
- **Denetim kaydı (audit log)**: Oda oluşturma/katılım/süre dolma ve transfer teklif/kabul/red/iptal/tamamlanma olayları **sadece metadata** olarak (`dosya adı`, `boyut`, `durum`, zaman damgası — asla bayt) `auditLog.ts` ile Redis listesine yazılır. Bu olaylar istemciden `transfer-event` soket olayıyla (fire-and-forget) bildirilir; sunucu göndereni doğrular (sadece kendi odasına ait event kabul edilir) ve dosya adını/boyutunu doğrular.
- **Rate limiting**: 6 haneli kod ile katılım denemeleri klasik `INCR` + `EXPIRE` Redis desenle sınırlanır (`joinAttemptLimiter.ts`) — ek bir temizlik job'una gerek yok.
- **Ölçeklenebilirlik**: Redis paylaşılan durum olduğu için birden fazla sunucu örneği çalıştırmak (yatay ölçekleme) artık yalnızca Socket.io'nun Redis adaptörünü eklemeyi gerektirir; oda durumu zaten paylaşılan depoda.

`/api/stats` uç noktası herkese açıktır ama **sadece toplu/anonim sayaçlar** döner (`activeRooms`, `totalRoomsCreated`) — tek tek oda/transfer detayları asla dışa açılmaz; bu, başka kullanıcıların dosya adlarının sızmasını önler.

## Gereksinimler

- Node.js ≥ 18.17
- npm ≥ 9
- Docker (Redis'i `docker compose` ile çalıştırmak için) — alternatif olarak yerel bir Redis kurulumu da kullanılabilir.

## Kurulum

### Hızlı başlangıç (Windows, tek dosya)

Redis, sunucu ve istemciyi tek seferde, üç ayrı pencerede başlatmak için proje kökündeki [`start-all.bat`](start-all.bat) dosyasına çift tıklayın:

```bash
start-all.bat
```

`node_modules` yoksa her pencere kendi `npm install`'unu otomatik çalıştırır. Sunucu hazır olduğunda tarayıcıda `http://localhost:5173` açılır — ayrıca bkz. [`redis-portable/start-redis.bat`](redis-portable/start-redis.bat) (sadece Redis) ve aşağıdaki manuel adımlar.

### 1. Redis

**Docker varsa (önerilen):**

```bash
docker compose up -d
```

Bu, `redis:7-alpine` imajını AOF kalıcılığı ve `notify-keyspace-events Ex` (self-destruct için gerekli) etkinken `localhost:6379` üzerinde başlatır.

**Docker yoksa (Windows, taşınabilir binary):** `redis-portable/start-redis.bat` dosyasına çift tıklayın (veya bir terminalde çalıştırın) ve o pencereyi açık bırakın:

```bash
redis-portable\start-redis.bat
```

Bu, kuruluma gerek duymadan `--notify-keyspace-events Ex` etkin bir Redis 5 sunucusunu `localhost:6379`'da başlatır — self-destruct mekanizması için gereken keyspace-notification desteği zaten açık gelir. (Kalıcılık istenmiyorsa AOF kapalıdır; sadece geliştirme/demo amaçlıdır.)

### 2. Sunucu

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

Sunucu varsayılan olarak `http://localhost:4000` adresinde çalışır ve `REDIS_URL` üzerinden Redis'e bağlanır. Redis erişilemezse sunucu **kasıtlı olarak** başlamayı reddeder (fail-closed) — güvenlik açısından kritik oda durumunun sessizce bellek-içi bir moda düşmesini istemiyoruz.

### 3. İstemci

Yeni bir terminalde:

```bash
cd client
npm install
cp .env.example .env
npm run dev
```

İstemci `http://localhost:5173` adresinde açılır ve `.env` içindeki `VITE_SERVER_URL` üzerinden sinyalleşme sunucusuna bağlanır.

Tarayıcıda `http://localhost:5173` adresini açın. İki eşi test etmek için aynı adresi ikinci bir sekmede (veya farklı bir cihazda, aynı ağda) açın ve oluşturulan 6 haneli kodu ya da QR bağlantısını kullanın.

## Üretime Alma Notları

- **TURN sunucusu**: Sadece STUN (`stun:stun.l.google.com:19302`) simetrik NAT'lar arkasındaki bazı ağlarda P2P bağlantı kurmaya yetmez. Üretimde `client/.env` içindeki `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` değerlerini bir TURN sağlayıcısıyla (coturn, Twilio, Cloudflare Calls vb.) doldurun.
- **HTTPS zorunluluğu**: Tarayıcıların WebRTC ve Clipboard API güvenlik politikaları gereği üretimde hem istemci hem sunucu HTTPS/WSS üzerinden servis edilmelidir.
- **CORS**: `server/.env` içindeki `CLIENT_ORIGIN` değerini üretim istemci alan adınızla güncelleyin.
- **Redis kimlik doğrulama/TLS**: Üretimde `REDIS_URL`'i `rediss://user:password@host:port` biçiminde, kimlik doğrulamalı ve TLS'li bir Redis örneğine (örn. Redis Cloud, AWS ElastiCache) işaret edecek şekilde ayarlayın.
- **Yatay ölçekleme**: Oda durumu artık Redis'te paylaşılan, ancak Socket.io soket-odaya-yayın (broadcast) mekanizması hâlâ tek process içi. Birden fazla sunucu örneği çalıştırmak için `@socket.io/redis-adapter` ekleyin — aynı Redis instance'ı zaten mevcut.

## Güvenlik Katmanı Özeti

| Kontrol | Nerede |
|---|---|
| Oda başına maksimum 2 istemci | `roomManager.ts` → `joinRoom` |
| Süre dolunca otomatik imha (`ROOM_EXPIRED`) + veritabanından silme | Redis TTL + `redis.ts` keyspace-notification → `index.ts` → `handleRoomExpired` |
| Eş ayrılınca diğer tarafa bildirim + oda temizliği | `index.ts` → `handleDisconnect` |
| Bağlantı bazlı roomToken doğrulaması (link ile katılım) | `roomManager.ts` → `joinRoom` |
| 6 haneli kod için Redis tabanlı brute-force sınırlama | `joinAttemptLimiter.ts` |
| 100 MB dosya boyutu sınırı (istemci + P2P kontrol mesajı) | `useWebRTC.ts` → `sendFiles` / `file-offer` işleyicisi |
| İki taraflı transfer onayı | `ConfirmTransferModal.tsx` + `file-accept` / `file-reject` protokolü |
| Sıfır sunucu/veritabanı içerik depolaması | Dosya/metin baytları yalnızca `RTCDataChannel` üzerinden akar; Redis'e sadece metadata (ad/boyut/durum) yazılır |
| Denetim kaydının herkese açık sızıntı riski taşımaması | `/api/stats` yalnızca anonim toplu sayaç döner, ham audit log'a genel erişim yoktur |
