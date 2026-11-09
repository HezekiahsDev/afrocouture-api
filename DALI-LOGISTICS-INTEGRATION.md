# Dali Logistics Partners

Businesses send delivery requests to Dali from their own systems, and Dali riders pick up and deliver.

- **Part 1** is for the Dali team setting a partner up.
- **Part 2** is for the partner's developers.

---

## Part 1: Setting up a partner

### How it works

A partner is a business (a shop, a pharmacy, a restaurant chain) that wants deliveries without hiring riders. They don't log in to Dali or use the app. Their own software talks to the Dali API with a secret key.

```
Partner tops up by bank transfer → creates a delivery by API → fee taken from balance
→ Dali assigns a rider → rider delivers with the PIN → partner gets live updates
```

Partner deliveries go through the same routing desk as Dali's own deliveries, so the ops team sees and routes them on the Deliveries board.

Billing is prepaid: no balance, no delivery. Cancelling before pickup refunds the fee to the balance.

### What we need from the partner

| Item                    | Required          | Why                                                                                                                      |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Business name           | Yes               | Shown in the console and on their deliveries.                                                                            |
| Registered (legal) name | Optional          | For invoices and KYB records.                                                                                            |
| Contact name and email  | Yes               | The person we send keys and support to.                                                                                  |
| Contact phone           | Optional          | For urgent delivery issues.                                                                                              |
| Webhook URL             | Recommended       | An **HTTPS** address on their server where Dali posts status updates. It must be a public address.                       |
| Server IP addresses     | Optional          | If given, their keys only work from those IPs. Good for security, but leave it empty if their IPs change.                |
| Expected daily volume   | Yes               | Sets their daily delivery cap, so a bug on their side can't drain their balance.                                         |
| Service area            | Yes               | Pickups and drop-offs must both be inside an active Dali delivery zone. Today that's Kano city, Wudil and Akoka (Lagos). |
| First top-up            | Before going live | A bank transfer to Dali with a reference we can record.                                                                  |

### Onboarding steps (admin console)

All of this happens under **Logistics → Partners** in the admin console. Staff need the `partners:*` permissions:

- `partners:manage` to create and edit partners
- `partners:keys` for keys and the webhook secret
- `partners:billing` for top-ups

1. **Create the partner.** Enter the business and contact details. The partner starts as _Pending_, so only test keys work.
2. **Issue a test key.** Name it (for example "Staging"), choose _test_, and tick all four scopes unless they need less. The key is shown **once**: copy it and send it securely.
3. **Send them this guide** and the docs link in Part 2. Their developers build and test with the test key. Test deliveries are free and never reach a real rider.
4. **Set the webhook.** Save their HTTPS webhook URL, then rotate the webhook secret. The secret is shown once; send it to them securely. They can check their endpoint with `POST /webhooks/test`.
5. **Set limits.** Set the daily delivery cap from their expected volume and, if they gave any, the allowed IP addresses.
6. **Record the top-up.** When their transfer lands, use _Top up_ with the amount and the bank reference. A repeated reference is refused, so a payment can't be recorded twice.
7. **Issue a live key and activate.** Create a _live_ key, send it securely, then set the status to _Active_. Live deliveries now take the fee from their balance and go to real riders.

> **Keys and secrets are shown only once.** Dali stores only a fingerprint of each key, so a lost key can't be recovered: issue a new one and revoke the old one. To cut a partner off right away, set the status to _Suspended_.

The partner's page also shows:

- their balance
- every API request, kept for 90 days
- every webhook attempt, kept for 30 days; a failed one can be retried from there

### What the partner gets

**From us at onboarding**

- A test API key (`dl_test_…`)
- A live API key (`dl_live_…`), once they're active
- A webhook signing secret (`whsec_…`)
- This guide and the interactive API docs

**On every delivery**

- A price before they book (a quote)
- A 4-digit delivery PIN to give their customer
- The rider's name, phone, vehicle and rating once a rider is assigned
- Status updates sent to their webhook
- A refund to their balance if they cancel before pickup

---

## Part 2: Developer guide

### Access and keys

There is no partner dashboard or login. Everything happens through the HTTPS API with a key Dali gives you.

|                  |                                                                  |
| ---------------- | ---------------------------------------------------------------- |
| Base URL         | `https://dali-api.alcance.ng/api/v1/partner/v1`                  |
| Interactive docs | <https://dali-api.alcance.ng/api/partner/docs>                   |
| Auth header      | `Authorization: Bearer dl_live_…`                                |
| Format           | JSON in, JSON out. Money is in Naira (NGN), distances in metres. |

**Two kinds of key:**

- `dl_test_` keys create simulated deliveries. They're free, never reach a rider, and are kept apart from live data.
- `dl_live_` keys create real deliveries and charge your balance.

Keep keys on your server; never put them in a mobile app or website.

Every response is wrapped like this:

```json
{ "success": true,  "data": { } }
{ "success": false, "data": null, "code": "insufficient_balance", "message": "This delivery costs ₦1,500 and your balance is ₦900." }
```

Branch on `code`. The `message` is for people and may change.

### Endpoints

| Request                          | What it does                                                                                                                                                              | Scope                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `GET /me`                        | Your account, balance, daily cap and key details.                                                                                                                         | any                          |
| `POST /quotes`                   | Price a delivery between two points (`pickup` and `dropoff`, each a `{lat, lng}`). Treat the price as a guide for 15 minutes; creating a delivery always prices it again. | `logistics.quotes:read`      |
| `POST /deliveries`               | Create a delivery. Needs an `Idempotency-Key` header.                                                                                                                     | `logistics.deliveries:write` |
| `GET /deliveries`                | List your deliveries. Filter with `?status=` or `?external_reference=`, and page through results with `?page=&limit=`.                                                    | `logistics.deliveries:read`  |
| `GET /deliveries/{id}`           | One delivery.                                                                                                                                                             | `logistics.deliveries:read`  |
| `POST /deliveries/{id}/cancel`   | Cancel before pickup. The fee goes back to your balance. Optional body: `{"reason": "…"}`.                                                                                | `logistics.deliveries:write` |
| `POST /deliveries/{id}/simulate` | Test keys only: move a test delivery forward.                                                                                                                             | `logistics.deliveries:write` |
| `POST /webhooks/test`            | Send a signed `ping` to your webhook URL.                                                                                                                                 | `logistics.webhooks:manage`  |

### Create a delivery

```bash
curl -X POST https://dali-api.alcance.ng/api/v1/partner/v1/deliveries \
  -H "Authorization: Bearer $DALI_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ORD-1042-attempt-1" \
  -d '{
    "external_reference": "ORD-1042",
    "pickup": {
      "label": "Main Warehouse",
      "address": "12 Zaria Road, Kano",
      "lat": 11.9821, "lng": 8.5211,
      "contact_name": "Tunde", "contact_phone": "+2348012345678"
    },
    "dropoff": {
      "address": "Block C, BUK New Site, Kano",
      "lat": 11.9790, "lng": 8.4770,
      "contact_name": "Amina", "contact_phone": "+2348098765432"
    },
    "package_count": 1,
    "notes": "Call on arrival",
    "metadata": { "order_id": "1042" }
  }'
```

- `external_reference` is your order number. It must be unique per account; a repeat gets `duplicate_reference`.
- `Idempotency-Key` (up to 120 characters) makes retries safe. Sending the same key again returns the original delivery, not a second one, so reuse it when you retry after a timeout.
- These fields are optional:
  - `label`
  - `package_count` (1–50)
  - `notes` (up to 500 characters)
  - `metadata` (up to 4 KB, sent back to you as-is)

Response (shortened):

```json
{
  "success": true,
  "data": {
    "id": "3f9c…",
    "external_reference": "ORD-1042",
    "status": "pending",
    "livemode": true,
    "fee": 1500,
    "currency": "NGN",
    "distance_m": 4830,
    "delivery_pin": "4821",
    "runner": null,
    "pickup": {},
    "dropoff": {},
    "timestamps": { "created_at": "…", "assigned_at": null }
  }
}
```

> **Give `delivery_pin` to your customer** (by SMS or on their receipt). They tell it to the rider at the door, and the rider can't complete the delivery without it. Don't give it to anyone else.

### Statuses

| Status       | Meaning                                                   |
| ------------ | --------------------------------------------------------- |
| `pending`    | Created and waiting for a rider.                          |
| `assigned`   | A rider has accepted it. `runner` is now filled in.       |
| `picked_up`  | The rider has the package. It can no longer be cancelled. |
| `in_transit` | On the way to the drop-off.                               |
| `delivered`  | Handed over with the correct PIN.                         |
| `completed`  | Closed and settled. Final.                                |
| `cancelled`  | Cancelled before pickup; the fee was refunded. Final.     |
| `failed`     | Couldn't be delivered. Dali support will contact you.     |
| `disputed`   | Under review by Dali support.                             |

### Webhooks

Dali sends a `POST` to your webhook URL whenever a delivery changes. The events are:

- `delivery.created`, `delivery.routed`
- `delivery.assigned`, `delivery.unassigned`
- `delivery.picked_up`, `delivery.in_transit`
- `delivery.delivered`, `delivery.completed`
- `delivery.cancelled`, `delivery.failed`, `delivery.disputed`
- `ping`, sent only by the test endpoint

An example webhook body:

```json
{
  "id": "evt_8a1…",
  "type": "delivery.assigned",
  "created_at": "2026-11-08T10:15:02.000Z",
  "livemode": true,
  "data": {
    "job_id": "3f9c…",
    "external_reference": "ORD-1042",
    "status": "assigned",
    "fee": 1500,
    "currency": "NGN",
    "runner": {
      "name": "Musa Ibrahim",
      "phone": "+234…",
      "vehicle": "motorcycle",
      "rating": 4.8
    },
    "timestamps": {}
  }
}
```

- **Reply with any 2xx within 10 seconds.** Do any slow work after you reply.
- If you don't reply in time, Dali retries after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours, then stops. Dali support can send it again.
- The same event can arrive more than once. Use `id` to ignore repeats.
- Events can arrive out of order. Trust `data.status`, or call `GET /deliveries/{id}` when in doubt.

**Check the signature on every webhook.** The header is:

```
X-Dali-Signature: t=<unix seconds>,v1=<hex>
```

`v1` is the HMAC-SHA256 of `t + "." + raw body`, keyed with your `whsec_` secret. Sign the raw request body exactly as received, not JSON you've parsed and re-encoded.

```js
const crypto = require('crypto');

function verifyDaliSignature(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false; // older than 5 minutes
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

### Testing

Build everything with a `dl_test_` key first. Test deliveries are priced like live ones but cost nothing, and no rider sees them. Move one forward yourself and watch your webhooks arrive:

```
POST /deliveries/{id}/simulate
{ "status": "assigned" }      // then picked_up → in_transit → delivered → completed
                              // or "failed"
```

- Test webhooks carry `"livemode": false`.
- Test keys work while your account is still pending.
- Live keys start working once Dali activates the account.

### Errors

| HTTP | Code                                                                                                   | What to do                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 400  | Validation errors, `idempotency_key_required`, `metadata_too_large`                                    | Fix the request.                                                          |
| 401  | `invalid_api_key`, `api_key_revoked`, `api_key_expired`                                                | Check the key, or ask Dali for a new one.                                 |
| 402  | `insufficient_balance`                                                                                 | Top up, then retry.                                                       |
| 403  | `partner_not_active`, `partner_suspended`, `ip_not_allowed`, `insufficient_scope`, `test_key_required` | Contact Dali, or use the right key.                                       |
| 404  | `delivery_not_found`                                                                                   | Wrong ID, or a test delivery's ID used with a live key (or the reverse).  |
| 409  | `duplicate_reference`, `idempotency_key_reused`, `cancellation_not_allowed`, `invalid_transition`      | The delivery already exists or has moved on. Fetch it to see where it is. |
| 422  | `out_of_zone`, `distance_too_far`, `invalid_pickup`, `invalid_dropoff`                                 | Dali can't serve this route.                                              |
| 429  | `rate_limited`, `daily_job_cap_reached`                                                                | Slow down. If you need a higher daily cap, ask Dali.                      |

### Limits

|                  |                                            |
| ---------------- | ------------------------------------------ |
| Requests         | 300 per minute per key                     |
| Distance         | Up to 100 km, pickup to drop-off           |
| Service area     | Both ends inside an active Dali zone       |
| Daily deliveries | Set per account by Dali (rolling 24 hours) |
| Cancelling       | Only before the rider picks up             |
| Metadata         | 4 KB                                       |
