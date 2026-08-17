# SecureShare — Zaman Ayarlı ve Güvenli Web Paylaşım Portalı

Uçtan uca **WebRTC P2P** üzerinden, sunucudan hiçbir dosya baytının geçmediği, zaman ayarlı ve kendini imha eden bir dosya/metin paylaşım portalı.

## Mimari

- `server/` — Node.js + TypeScript + Express + Socket.io. Sadece **sinyalleşme** (offer/answer/ICE) ve **oda yaşam döngüsü** yönetimini yapar. Hiçbir dosya baytı sunucuya uğramaz.
- `client/` — React + TypeScript + Tailwind CSS. WebRTC `RTCDataChannel` üzerinden ikili (binary) chunk aktarımı, geri basınç (backpressure) kontrolü, QR kod eşleşmesi ve senkronize geri sayım.

```
tempdrop/
├── server/
│   └── src/
│       ├── index.ts              # Express + Socket.io giriş noktası
│       ├── roomManager.ts        # Oda oluşturma, self-destruct timer, üyelik
│       ├── joinAttemptLimiter.ts # 6 haneli kod için brute-force koruması
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

## Gereksinimler

- Node.js ≥ 18.17
- npm ≥ 9

## Kurulum

### 1. Sunucu

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

Sunucu varsayılan olarak `http://localhost:4000` adresinde çalışır.

### 2. İstemci

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
- **HTTPS zorunluluğu**: `getUserMedia` gerekmese de, tarayıcıların WebRTC ve Clipboard API güvenlik politikaları gereği üretimde hem istemci hem sunucu HTTPS/WSS üzerinden servis edilmelidir.
- **CORS**: `server/.env` içindeki `CLIENT_ORIGIN` değerini üretim istemci alan adınızla güncelleyin.
- **Ölçekleme**: Oda durumu şu an bellek içi (`Map`) tutulur. Birden fazla sunucu örneği (yatay ölçekleme) çalıştıracaksanız `roomManager.ts` içindeki durumu Redis gibi paylaşılan bir depoya taşıyın ve Socket.io'yu Redis adaptörüyle çalıştırın.

## Güvenlik Katmanı Özeti

| Kontrol | Nerede |
|---|---|
| Oda başına maksimum 2 istemci | `roomManager.ts` → `joinRoom` |
| Süre dolunca otomatik imha (`ROOM_EXPIRED`) + bellekten silme | `roomManager.ts` → `setTimeout` / `destroyRoom` |
| Eş ayrılınca diğer tarafa bildirim + oda temizliği | `index.ts` → `handleDisconnect` |
| Bağlantı bazlı roomToken doğrulaması (link ile katılım) | `roomManager.ts` → `joinRoom` |
| 6 haneli kod için brute-force sınırlama | `joinAttemptLimiter.ts` |
| 100 MB dosya boyutu sınırı (istemci + P2P kontrol mesajı) | `useWebRTC.ts` → `sendFiles` / `file-offer` işleyicisi |
| İki taraflı transfer onayı | `ConfirmTransferModal.tsx` + `file-accept` / `file-reject` protokolü |
| Sıfır sunucu depolaması | Dosya baytları yalnızca `RTCDataChannel` üzerinden akar, Socket.io yalnızca SDP/ICE taşır |
