# Orders, payments, chat & AI Studio — API contract

Source of truth for the Phase 4–5 build. Entities live in `src/orders/entities`, `src/escrow/entities`,
`src/chat/entities`, `src/ai-studio/entities`. Money is **whole naira** everywhere in our API and DB;
convert to kobo (×100) only at the Paystack boundary.

## Money rules

- Fabric line price = the fabric's best tier for the quantity: the `priceTiers` entry with the largest
  `minQuantity <= quantity`, else `fabric.price`. `lineTotal = unitPrice × quantity`. Snapshotted on request.
- On quote: `subtotal = workmanshipPrice + deliveryFee + fabricTotal`;
  `platformFee = round(subtotal × PLATFORM_FEE_PERCENT / 100)` (env, default `0`);
  `totalAmount = subtotal + platformFee`.
- Escrow balance of an order = successful `hold` − successful/pending releases and refunds. Never pay out more than the balance.
- Payout to tailor on completion = `workmanshipPrice + deliveryFee`. Payout to each merchant = sum of their `lineTotal`s,
  released when the tailor marks that merchant's fabric **received**. Platform fee stays with the platform.

## Order lifecycle & who can do what

| Action | Endpoint | Who | From → to |
| --- | --- | --- | --- |
| Request a commission | `POST /orders` | customer (needs a fit profile with ≥1 measurement + delivery address) | → `requested` |
| Quote | `POST /orders/:id/quote` `{ workmanshipPrice, deliveryFee, estimatedDeliveryDate, note? }` | tailor | `requested`/`quoted` → `quoted` (re-quote allowed before payment) |
| Decline | `POST /orders/:id/decline` `{ reason }` | tailor | `requested`/`quoted` → `declined` |
| Cancel | `POST /orders/:id/cancel` | customer | `requested`/`quoted` → `cancelled` |
| Start payment | `POST /orders/:id/pay` → `{ authorizationUrl, reference }` | customer | `quoted` (stays `quoted` until verified) |
| Verify payment | `POST /orders/:id/verify-payment` `{ reference }` (called by the web callback page) and the webhook | customer / Paystack | `quoted` → `paid` (+ escrow `hold` success) |
| Advance milestone | `POST /orders/:id/milestone` `{ milestone: 'cutting' \| 'fitting' \| 'delivery', note? }` | tailor | `paid`/`in_progress` → `in_progress`; forward only |
| Ship fabric | `POST /orders/:id/items/:itemId/ship` `{ note? }` | the item's merchant | item `pending` → `shipped` (order must be `paid`/`in_progress`) |
| Receive fabric | `POST /orders/:id/items/:itemId/receive` | tailor | item `shipped` → `received`; triggers merchant payout |
| Mark delivered | `POST /orders/:id/deliver` `{ note? }` | tailor (milestone must be `delivery`) | `in_progress` → `delivered` |
| Approve | `POST /orders/:id/approve` `{ rating (1–5), review? }` | customer | `delivered` → `completed`; triggers tailor payout |
| Dispute | `POST /orders/:id/dispute` `{ reason }` | customer | `paid`/`in_progress`/`delivered` → `disputed` |
| Resolve dispute | `POST /admin/orders/:id/resolve` `{ outcome: 'release' \| 'refund', refundAmount?, note }` | admin | `disputed` → `completed` (release remaining) or `refunded` (refund `refundAmount` or full balance; any remainder released to tailor) |
| Retry payout | `POST /admin/escrow/:transactionId/retry` | admin | failed release → pending |

Reads:

- `GET /orders?role=customer|tailor|merchant&status=` — the caller's orders (merchant: orders containing their fabric lines).
- `GET /orders/:id` — order + items + tailor summary (public tailor fields) + customer name + events + escrow summary
  `{ held, released, refunded, balance }`. Customers and tailors see everything; merchants see only their own lines and
  the tailor's workshop address (to ship to), not the customer's measurements or address.
- `GET /admin/orders?status=disputed` and `GET /admin/escrow?status=failed` — admin queues.

Every state change appends an `order_events` row and emits `order.event` (see Events); every change also emails the
other party (best effort, via `MailService`).

## Payments — Paystack (`src/payments`)

`PaystackService` wraps the REST API (`PAYSTACK_BASE_URL`, default `https://api.paystack.co`; bearer `PAYSTACK_SECRET_KEY`).
If the key is missing every payment endpoint returns **503 "Payments are not available right now."**

- Initialize: `POST /transaction/initialize` `{ email, amount (kobo), reference, callback_url, metadata: { orderId } }`.
  Reference: `${order.reference}-${n}` (unique per attempt). `callback_url = ${PAYMENT_CALLBACK_URL}` (env; default first
  `FRONTEND_URL` origin + `/orders/payment-callback`).
- Verify: `GET /transaction/verify/:reference` — accept only `status === 'success'`, `currency === 'NGN'`,
  `amount === totalAmount × 100`, metadata.orderId matches. Idempotent.
- Webhook: `POST /payments/paystack/webhook` — raw body HMAC-SHA512 with the secret key must equal
  `x-paystack-signature`, else 401. Handles `charge.success` (same as verify), `transfer.success`,
  `transfer.failed`, `transfer.reversed` (update the escrow transaction by reference), `refund.processed`/`refund.failed`.
  Always answer 200 quickly once the signature is valid.
- Banks: `GET /payments/banks` (public, cached 24h in Redis) → `[{ name, code }]` from `GET /bank?country=nigeria&currency=NGN`.
- Resolve: `GET /payments/resolve-account?accountNumber=&bankCode=` (auth) → `{ accountName }` from `GET /bank/resolve`.
- Payouts: create a transfer recipient (`POST /transferrecipient`, type `nuban`) lazily and store `paystackRecipientCode`
  on the profile (cleared when bank details change); then `POST /transfer` `{ source:'balance', amount, recipient, reference, reason }`.
  A transfer that Paystack accepts as `pending`/`otp` stays `pending` until the webhook. Errors → `failed` + `failureReason`.
- Refunds: `POST /refund` `{ transaction: holdReference, amount (kobo) }`.

Profiles: `SaveTailorProfileDto` / `SaveMerchantProfileDto` gain `bankCode`; `bankCode` joins the submit-required lists.
Changing `bankCode`/`accountNumber` clears `paystackRecipientCode`.

## Chat (`src/chat`)

- REST: `GET /orders/:id/messages?before=<iso>&limit=50` (newest last), `POST /orders/:id/messages` `{ content, attachmentUrl? }`
  — customer and tailor of the order only; not allowed once the order is `declined`/`cancelled`.
- Socket.IO namespace `/chat`, auth via `handshake.auth.token` (access JWT). Client emits `join_order { orderId }`
  (ack `{ ok: true }` or `{ ok: false, error }`), `leave_order`, `send_message { orderId, content, attachmentUrl? }`,
  `typing { orderId }`. Server emits to room `order:<id>`: `new_message <ChatMessage>`, `typing { orderId, userId }`,
  `order_updated { orderId, status, milestone }`.
- System messages: `ChatService` listens to `order.event` and posts a `system` message with the event label, then emits
  `new_message` and `order_updated`.
- Upload purpose `chat` (images only) is added to `/uploads`.

## Events (in-process, `@nestjs/event-emitter`)

```ts
// emitted by OrdersService after every recorded OrderEvent
'order.event' → { orderId: string; type: string; label: string; status: OrderStatus; milestone: OrderMilestone; actorUserId: string | null }
```

## AI Studio (`src/ai-studio`)

- `POST /ai-studio/generate` `{ prompt (10–400 chars), garmentType?, occasion?, fabric?, colour?, count? (1–4, default 4), aspectRatio? ('3:4' | '1:1' | '9:16') }`
  → `AiDesign`. Calls Vertex AI Imagen
  `POST https://{VERTEX_AI_LOCATION}-aiplatform.googleapis.com/v1/projects/{VERTEX_AI_PROJECT_ID}/locations/{VERTEX_AI_LOCATION}/publishers/google/models/{VERTEX_IMAGEN_MODEL}:predict`
  (`VERTEX_API_BASE_URL` overrides the host for tests) with a token from `google-auth-library` using
  `GOOGLE_APPLICATION_CREDENTIALS_JSON` (service-account JSON, single line) or `GOOGLE_APPLICATION_CREDENTIALS` (path).
  The prompt is wrapped with fixed guidance (photorealistic fashion photo of a single garment, African tailoring, no text,
  no logos). Images (base64) are uploaded to Cloudinary folder `ai-designs/<userId>`. Not configured → 503.
- Limits: `AI_DAILY_LIMIT` generations per user per day (default 20) — 429 with a clear message.
- `GET /ai-studio/designs?saved=true|false&limit=&before=` (own), `GET /ai-studio/designs/:id` (own),
  `PATCH /ai-studio/designs/:id` `{ saved?, selectedIndex? }`, `DELETE /ai-studio/designs/:id`.
- `POST /orders` accepts `aiDesignId` (must belong to the customer); the selected image is added to `referenceImageUrls`.

## Rate limiting (Redis)

Global `RedisModule` (`REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`). `@RateLimit({ name, limit, windowSec, by: ('ip' | 'email' | 'user')[] })`
+ `RateLimitGuard`; fixed window via `INCR` + `EXPIRE`; responds **429** `{ message: 'Too many attempts. Try again in N minutes.' }`
with `Retry-After`. If Redis is down: log and allow (fail open). `app.set('trust proxy', 1)` so `req.ip` is the client behind nginx.

Applied: login 10/15 min per IP+email and 30/15 min per IP; register 5/hour per IP; verify-email & reset-password
10/15 min per email; forgot-password & resend 5/hour per email; uploads 60/hour per user; AI generate is covered by
`AI_DAILY_LIMIT` plus 10/min per user.

## Fabrics — wholesale tiers

`CreateFabricDto`/`UpdateFabricDto` gain `priceTiers: { minQuantity (2–200), price }[]` (max 5), validated: strictly
ascending `minQuantity`, strictly descending `price`, every tier price < base `price`. Public fabric responses include
`priceTiers`. Helper `unitPriceFor(fabric, quantity)` is shared with orders.

## New env

```
PAYSTACK_SECRET_KEY=           # sk_test_… / sk_live_…
PAYSTACK_BASE_URL=https://api.paystack.co
PAYMENT_CALLBACK_URL=          # default: <first FRONTEND_URL>/orders/payment-callback
PLATFORM_FEE_PERCENT=0
VERTEX_AI_PROJECT_ID=
VERTEX_AI_LOCATION=us-central1
VERTEX_IMAGEN_MODEL=imagen-3.0-generate-002
GOOGLE_APPLICATION_CREDENTIALS_JSON=
AI_DAILY_LIMIT=20
```
