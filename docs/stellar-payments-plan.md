# Stellar payments — implementation plan

Adds Stellar as a second payment method next to Paystack. Customers can pay for an order in USDC on Stellar,
and tailors and merchants can choose to receive payouts in USDC instead of to a Nigerian bank.

**Escrow does not change.** Our Postgres ledger (`escrow_transactions`) stays the record of who is owed
what, in whole naira. Stellar is only another way to move money in and out, just like Paystack. There is
no smart-contract escrow in this plan.

Read with [orders-payments-ai-contract.md](orders-payments-ai-contract.md), which defines the money rules
this plan keeps.

## Status (2026-11-28)

**Update, Nov 28:** Stellar now lives in the separate **stellar-payment-service**. This API calls it over HTTP and receives signed webhooks (see the contract doc). A live testnet run passed end to end: a real payment paid an order, a real USDC payout went to a merchant, a double payment was refunded, and a memo-less deposit was flagged. The notes below describe the original in-process build.

### Original status (2026-11-26)

**Phases 1 and 2 are built, behind flags (off by default).** The API contract is in
[orders-payments-ai-contract.md § Payments — Stellar USDC](orders-payments-ai-contract.md#payments--stellar-usdc).
Changes from the plan below:

- The watcher **polls** Horizon every `STELLAR_POLL_MS` instead of streaming. This is simpler and safe across restarts.
- Exactly-once sending also **claims** each row (`txHash = claim:<uuid>`) before signing, so two workers can't sign the same payout.
- FX config is `FX_RATE_PROVIDER=fixed|url` with `FX_NGN_PER_USDC` or `FX_RATE_URL` + `FX_RATE_JSON_PATH`, bounded by `FX_RATE_MIN/MAX`.
- Web checkout uses a SEP-7 "Open in wallet" link plus copyable amount, address and memo. **No QR code and no Stellar Wallets Kit
  yet**, to avoid adding new frontend dependencies while the repos are being secured. Add them after a dependency review.
- **Not built yet:** the daily payout cap (§9), Phase 3 (anchors), the testnet end-to-end script (§10). The automated e2e test
  `test/stellar-payments.e2e-spec.ts` covers the same flows against a fake Horizon.
- Phase 0 is still open: legal advice, FX source and spread, and creating the accounts and keys.

---

## 1. Scope

| Phase | What ships | Who it's for |
| --- | --- | --- |
| 0 | Decisions, accounts, keys, legal check | Founders / ops |
| 1 | Customer checkout in USDC (wallet or QR), refunds back in USDC | Diaspora customers, crypto users |
| 2 | Payouts in USDC to a tailor's or merchant's Stellar address | Artisans who want dollars |
| 3 | Anchors: pay in local currency and cash out to a naira bank through Stellar | Everyone, without seeing crypto |
| 4 | Hardening and mainnet launch | — |

Out of scope: Soroban contracts, holding XLM as a payment asset, any token of our own.

## 2. Decisions to make first (Phase 0)

These change the design, so settle them before writing code.

1. **Legal.** Accepting and paying out digital assets in Nigeria falls under SEC Nigeria and CBN rules.
   Get written advice on whether we can take USDC directly (Phases 1–2) or should only go through licensed
   anchors (Phase 3). If the answer is "anchors only", skip to Phase 3 and reuse Phase 1's watcher.
2. **Who carries FX risk.** Orders are priced in naira, and USDC payments are converted at a locked rate.
   Between payment and payout the naira can move. Options:
   - **A. Hold USDC and pay out at the rate on the payout day (recommended for v1).** Obligations stay in naira, and
     the platform gains or loses the difference. Small at our volumes. Track it in the admin treasury view (§8).
   - **B. Convert to naira when the payment arrives.** No FX exposure, but each payment needs an exchange
     or anchor trade, and USDC payouts must be bought back.
3. **Rate source.** We need a NGN→USD rate we trust. Candidates: an anchor's SEP-38 quote endpoint, an
   exchange's public ticker, or a paid FX API. Whatever we pick goes behind `FxRateService` (§5.3), so it can be swapped later.
4. **Spread.** A margin on checkout quotes (e.g. 1.5%) to cover FX movement and conversion costs.
   It's configurable, and customers see the USDC amount, never the spread.
5. **Asset.** USDC issued by Circle only. Don't accept other assets, except through path payments that
   deliver USDC to us (§5.4).

## 3. Stellar accounts and keys

| Account | Purpose | Key custody |
| --- | --- | --- |
| **Operating** | Receives customer payments, sends payouts and refunds. Holds a working float only. | Hot key in the secrets manager (not `.env`), loaded at boot, never logged. |
| **Treasury** | Holds everything above the float. | 2-of-3 multisig, signers held by different founders on hardware wallets. Never on a server. |

- Both accounts need a USDC trustline and enough XLM for the base reserve, trustlines and fees.
- **Float policy:** when the Operating USDC balance goes above `STELLAR_FLOAT_MAX_USDC`, raise an alert
  so an admin can sweep the extra to Treasury. When it goes below what pending payouts need, alert for a top-up from
  Treasury. Treasury moves are signed by hand (Stellar Laboratory or a wallet), never by the API.
- Create matching accounts on **testnet** for development and staging.

## 4. Configuration

Add these to `.env.example`, the README env table and the boot config check. When `STELLAR_ENABLED` is not
`true`, every Stellar endpoint returns **503 "Stellar payments are not available right now."**, just as
Paystack does without its key.

| Variable | Example | Notes |
| --- | --- | --- |
| `STELLAR_ENABLED` | `false` | Master switch for checkout. |
| `STELLAR_PAYOUTS_ENABLED` | `false` | Separate switch for payouts (Phase 2). |
| `STELLAR_NETWORK` | `testnet` / `public` | Chooses the network passphrase. |
| `STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` | Use a provider's endpoint in production rather than the public SDF one. |
| `STELLAR_OPERATING_PUBLIC` | `G...` | Where customers pay. |
| `STELLAR_OPERATING_SECRET` | `S...` | From the secrets manager. Required only when payouts or refunds are on. |
| `STELLAR_USDC_ISSUER` | `G...` | Circle's USDC issuer for the network. **Copy it from Circle's docs; don't type it from memory.** |
| `STELLAR_QUOTE_TTL_MIN` | `15` | How long a checkout rate is held. |
| `STELLAR_FX_SPREAD_BPS` | `150` | Spread on checkout quotes, in basis points. |
| `STELLAR_LATE_TOLERANCE_BPS` | `100` | A late payment is still accepted if it covers the price at today's rate within this tolerance. |
| `STELLAR_FLOAT_MAX_USDC` | `5000` | Alert threshold for sweeping to Treasury. |
| `STELLAR_MIN_XLM` | `20` | Alert when Operating XLM (used for fees) drops below this. |
| `FX_RATE_PROVIDER`, `FX_RATE_API_KEY` | — | Depend on the Phase 0 decision. |

New dependencies: `@stellar/stellar-sdk` in the API; `@creit.tech/stellar-wallets-kit` and a QR
library in the web app. Pin exact versions.

## 5. Phase 1 — Checkout in USDC

### 5.1 Customer flow

```
Order is QUOTED → customer picks "Pay with USDC (Stellar)"
→ API locks a rate and returns: address, memo, USDC amount, expiry, SEP-7 link
→ customer pays from a connected wallet (one click) or by scanning the QR / copying the details
→ the watcher sees the payment, matches the memo, checks asset and amount
→ escrow HOLD recorded in naira → order PAID (the same transition Paystack uses today)
→ the web app updates live over the existing socket.io connection
```

### 5.2 Data model

**New table `stellar_payment_intents`** has one row per checkout attempt, like a Paystack reference:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `orderId` | uuid, indexed | |
| `reference` | varchar, unique | `${order.reference}-S${n}`, e.g. `AC-7F3K2Q-S1`. **This is also the memo** (text memo, ≤ 28 bytes). The `-S` keeps it apart from Paystack's `-1`, `-2` attempts. |
| `nairaAmount` | int | `order.totalAmount` at quote time. |
| `usdcAmount` | numeric(20,7) | Stellar has 7 decimal places. Handle it as a string or `bigint` stroops in code, **never a JS float**. |
| `fxRate` | numeric(20,7) | NGN per USDC, spread included. |
| `expiresAt` | timestamptz | `now + STELLAR_QUOTE_TTL_MIN`. |
| `status` | enum | `awaiting`, `paid`, `expired`, `refunded`, `rejected` |
| `payerAddress` | varchar null | Set when the customer connects a wallet; otherwise filled from the payment. |
| `refundAddress`, `refundMemo` | varchar null | Optional, asked for when the customer says they're paying from an exchange (§5.6). |
| `txHash` | varchar null, unique | The payment that settled it. |
| `createdAt`, `updatedAt` | timestamptz | |

**`escrow_transactions`** gains these columns (all nullable, so existing rows are untouched):

| Column | Type | Notes |
| --- | --- | --- |
| `provider` | enum `paystack` / `stellar`, default `paystack` | Decides how `execute()` moves money. |
| `assetAmount` | numeric(20,7) null | USDC that actually moved. |
| `fxRate` | numeric(20,7) null | Rate used for this row. |
| `txHash` | varchar null | Stellar transaction hash (also mirrored to `providerCode`). |
| `submittedUntil` | timestamptz null | Upper time bound of the signed transaction (§6.3). |

`amount` stays **whole naira**, so `summary()`, the balance rule and the admin overview SQL keep working
without changes.

**New table `stellar_cursor`**: one row `{ key: 'operating-payments', pagingToken }`. It's in Postgres rather than Redis
because losing it means missing payments.

**New table `stellar_unmatched_deposits`**: payments that arrived without a usable memo (§5.6).

One migration, following the existing naming: `src/database/migrations/<timestamp>-StellarPayments.ts`.

### 5.3 New services (`src/payments/stellar/`)

| File | Responsibility |
| --- | --- |
| `stellar.config.ts` | Reads env, builds `Horizon.Server`, network passphrase and USDC `Asset`. `assertConfigured()` mirrors `PaystackService.assertConfigured()`. |
| `stellar.service.ts` | Low-level calls: `loadAccount`, `hasUsdcTrustline(address)`, `buildPayment({ to, usdc, memo })`, `submit(tx)`, `findTransaction(hash)`. Wraps errors in `StellarError` with readable result codes (`op_no_trust`, `op_underfunded`, `tx_bad_seq`, ...). |
| `fx-rate.service.ts` | `quoteNgnToUsdc(naira)` (with spread, for checkout) and `rateForPayout()` (mid rate). Cached in Redis for 60 s. Throws if the source is down, so checkout fails closed rather than quoting a stale rate. |
| `stellar-checkout.service.ts` | Creates intents and settles them (§5.5). |
| `stellar-watcher.service.ts` | Streams and reconciles incoming payments (§5.4). |
| `money.ts` | `toStroops(str)`, `fromStroops(bigint)`, `nairaToUsdc(naira, rate)` (always rounds **up** for checkout), `usdcShare(totalUsdc, part, whole)` (rounds **down** for refunds). Fully unit-tested. |

### 5.4 Watching for payments

`StellarWatcherService` implements `OnModuleInit` / `OnModuleDestroy`:

1. **Single runner.** Take a Redis lock (`SET stellar:watcher <instanceId> NX PX 30000`, renewed every 10 s)
   so only one API instance streams. Others retry the lock every 30 s.
2. **Stream** `server.payments().forAccount(OPERATING).cursor(saved).stream(...)`.
3. **Reconcile cron** (`@Cron` every minute): page through `payments().forAccount().cursor(saved)` in
   case the stream dropped. Both paths call the same idempotent `handle(record)`.
4. `handle(record)`:
   - Ignore anything that isn't **incoming** to Operating: `payment`, `path_payment_strict_receive`, or
     `path_payment_strict_send` where `to === OPERATING`.
   - Ignore assets other than USDC from `STELLAR_USDC_ISSUER`. An unexpected asset goes to unmatched deposits
     with reason `wrong_asset`.
   - Load the transaction (`record.transaction()`) for its **memo** and **successful** flag. Skip failed ones.
   - Find the intent by `reference = memo`. If there's no memo or no match, record an unmatched deposit and alert.
   - Call `stellarCheckout.settle(intent, { txHash, from, usdcAmount, receivedAt })`.
   - Save the cursor **after** handling succeeds. Because handling is idempotent on `txHash`, replays are harmless.

> Horizon is the simplest way to stream payments with memos today. Before building, check the current
> Stellar docs for Horizon's status versus Stellar RPC. If we move to RPC later, only this service changes.

### 5.5 Settling an intent

`StellarCheckoutService.settle()` runs inside `OrdersService.transaction()` with `lockOrder()`, the
same pattern as `confirmPayment()`:

| Case | Result |
| --- | --- |
| Already settled (`txHash` exists on an intent or escrow row) | Do nothing. |
| Order `QUOTED`, before `expiresAt`, `usdcAmount >= intent.usdcAmount` | `recordHold(em, order, intent.reference, order.totalAmount, { provider: 'stellar', assetAmount: received, fxRate, txHash })`. Order → `PAID`, `paidAt`, milestone `PLACED`, event `paid` ("…received in USDC and held in escrow"). Intent → `paid`. If overpaid by more than 1%, also reserve a USDC refund of the extra. |
| Order `QUOTED`, **after** expiry | Price again at today's rate. If the received amount covers it within `STELLAR_LATE_TOLERANCE_BPS`, accept as above. Otherwise treat as a mismatch (next row). |
| Underpaid, order no longer `QUOTED` (cancelled, already paid, quote changed), or late and short | Record the hold at its naira value, then `reserveRefund()` for all of it, the same as Paystack's mismatch path. Intent → `rejected`. Tell the customer it's being refunded. |

`EscrowService.recordHold()` gets an optional 5th argument for the provider fields. Existing Paystack calls
don't change.

`OrdersService.pay()` becomes `pay(user, id, method: 'paystack' | 'stellar' = 'paystack')`. For `stellar` it
calls `stellarCheckout.createIntent(order, user, { payerAddress? })` and returns:

```json
{
  "method": "stellar",
  "reference": "AC-7F3K2Q-S1",
  "destination": "G...OPERATING",
  "memo": "AC-7F3K2Q-S1",
  "asset": { "code": "USDC", "issuer": "G..." },
  "amount": "38.1520000",
  "nairaAmount": 62000,
  "expiresAt": "2026-12-01T10:15:00Z",
  "sep7Uri": "web+stellar:pay?destination=G...&amount=38.152&asset_code=USDC&asset_issuer=G...&memo=AC-7F3K2Q-S1&memo_type=MEMO_TEXT"
}
```

If the latest intent for the order is still `awaiting` and unexpired, return it instead of creating a new one,
so a page refresh doesn't create a second memo. An expiry cron marks old intents `expired`. A payment that
arrives later is still handled by the late rule above.

New endpoints:

| Endpoint | Who | Purpose |
| --- | --- | --- |
| `GET /payments/methods` | Public | `{ paystack: bool, stellar: bool }` so the web app knows which options to show. |
| `POST /orders/:id/pay` `{ method }` | Customer | Extended as above. |
| `GET /orders/:id/stellar-intent` | Customer | Current intent and status, as a fallback when the socket isn't connected. |

### 5.6 Payments that don't match, and exchanges

People paying from an exchange (Binance, Coinbase, ...) send from a shared address. If they forget the
memo, or we refund to the sending address, the money is lost or stuck at the exchange.

- The checkout screen shows the **memo as required**, in large type, with a copy button and a warning.
- A checkbox "I'm paying from an exchange" asks for a **refund address and memo**, saved on the intent.
- Refunds go to `refundAddress`/`refundMemo` if set, otherwise to `payerAddress` / the sending address.
- Unmatched deposits appear in a new admin queue. An admin can **attach** one to an order (which runs `settle`) or
  **refund** it to an address and memo they enter. Every action is recorded in the existing audit log.

### 5.7 Refunds of Stellar payments

`EscrowService.execute()` branches on the **HOLD's** `provider`:

- Paystack hold → current code.
- Stellar hold → USDC refund = `usdcShare(hold.assetAmount, tx.amount, hold.amount)`. The customer gets back the
  same share of the USDC they paid, so they don't take FX risk on a refund. Submit it using the payout
  procedure in §6.3.

`retry()` and the failure alerts work as they do today. The alert title shows both naira and USDC.

### 5.8 Web app

- `orders/checkout` and the order page: a payment method chooser, shown when `GET /payments/methods` says Stellar is on.
- New `components/payments/StellarPay.tsx`:
  - "Connect wallet" through Stellar Wallets Kit (Freighter, LOBSTR, xBull, Albedo, ...). It builds the
    payment in the browser and asks the wallet to sign. The API never sees the customer's keys.
  - Otherwise: QR of `sep7Uri`, plus address / amount / memo with copy buttons.
  - Countdown to `expiresAt`, then "Get a new quote".
  - Listens for the order's `paid` event on the existing socket. Polls `stellar-intent` every 5 s as a fallback.
- `lib/payments.ts`: `getPaymentMethods()`, `startStellarPayment()`, `getStellarIntent()`.
- Copy for all strings in the i18n dictionaries (en, ha, ig, yo).

## 6. Phase 2 — Payouts in USDC

### 6.1 Profile changes

`TailorProfile` and `MerchantProfile` gain:

| Column | Notes |
| --- | --- |
| `payoutMethod` | enum `bank` / `stellar`, default `bank`. |
| `stellarAddress` | `G...` public key. Muxed `M...` addresses are allowed if we decide to support them. |
| `stellarMemo` | Optional. Required when the address belongs to an exchange. |

- Add all three to `PAYOUT_FIELDS` in [payout-account.ts](../src/common/payout-account.ts) so verified artisans can still
  change them.
- Changing `stellarAddress`/`stellarMemo` sends the same "payout account changed" email through
  `notifyPayoutAccountChanged` (show the last 4 characters of the address).
- `payoutMethod = 'stellar'` requires a valid address that **exists and has a USDC trustline**, checked
  on save through `GET /payments/stellar/check-address?address=` (tailor/merchant, rate limited like
  `resolve-account`). Return a clear message for each failure: invalid address / account not found / no USDC trustline.

### 6.2 Reserving a payout

No change: `reserveRelease()` still reserves whole naira against the escrow balance. When
the row is created, set `provider` from the payee's `payoutMethod`.

### 6.3 Sending a Stellar payout or refund safely

Stellar has no single-use reference like Paystack. Submitting the same payment twice pays it twice. So:

1. Take the Redis lock `stellar:operating:submit`. One account can only have one transaction in flight per sequence
   number. Channel accounts can lift this limit later if volume needs it.
2. Work out `usdc = nairaToUsdc(tx.amount, fx.rateForPayout())`, rounded **down**. Save `assetAmount` and `fxRate`.
3. Build the payment with `timebounds.maxTime = now + 60s`, memo = `stellarMemo` if the payee has one, otherwise
   `tx.reference`, and a fee ceiling of ~10,000 stroops. Sign it.
4. **Before submitting**, save `txHash`, `providerCode = txHash` and `submittedUntil = maxTime`, with status `PENDING`.
5. Submit:
   - Success → `SUCCESS`.
   - Rejected with a result code → `FAILED` with a readable `failureReason` (e.g. "Payee removed their USDC
     trustline", "Operating account is low on USDC"). The existing alert fires.
   - Timeout / 5xx / network error → **leave it `PENDING`**. The reconciler decides.
6. **Reconciler cron** (every minute): for each `PENDING` Stellar row, look up `txHash`.
   - Found and successful → `SUCCESS`.
   - Not found, and the latest closed ledger time is after `submittedUntil` → it can never apply →
     `FAILED` ("Not confirmed on Stellar"). It is now safe for `retry()` to build a new transaction.

`retry()` keeps its rules (only `FAILED` rows, balance check, no newer release). For Stellar rows it also
clears `txHash`/`submittedUntil` and builds a new transaction at the current rate. Since `FAILED` is only set when the old
transaction provably can't land, a retry never pays twice.

### 6.4 Web app

- [verification/bank.tsx](../../afrocouture-web/src/components/onboarding/verification/bank.tsx): add "Receive payouts in USDC (Stellar)"
  with an address field, an optional memo field, an inline trustline check, and a short explainer with links to LOBSTR / Freighter.
- Tailor and merchant earnings: show USDC paid and a link to the transaction on a Stellar explorer.

## 7. Phase 3 — Anchors

Anchors let customers pay in local currency, and let payees receive naira in a bank account, with Stellar
used in between. This is where the Phase 0 legal answer matters most.

**Choosing anchors.** For each candidate, check: corridors (NGN payouts; GBP/USD/EUR/CAD
pay-ins), licences, which SEPs they support (SEP-10, 24, 38; SEP-31 for payouts), fees and limits, KYC handled
by them, settlement time, and a sandbox. Confirm all of this with the anchor directly, since corridor coverage
changes.

**Checkout through an anchor (SEP-24 deposit):**
1. API: SEP-10 web auth with the anchor, using a client signing key (not the Operating key).
2. API asks the anchor's SEP-38 for a quote, then starts an interactive SEP-24 deposit with the USDC destination
   = Operating and memo = intent reference.
3. Web app opens the anchor's hosted page (popup or iframe). The customer pays by card or bank in their own currency.
4. The anchor sends USDC to Operating with our memo. **The Phase 1 watcher settles it, with no new code.**
5. Poll the SEP-24 transaction status only to show progress to the customer.

**Payouts to a naira bank through an anchor (SEP-31 or SEP-24 withdraw):**
- New `payoutMethod = 'anchor_ngn'`. It uses the bank details we already collect.
- `execute()` posts to the anchor's SEP-31 `/transactions` with the receiver's bank details, then sends USDC to the anchor's
  address with the memo it returns, following §6.3. The anchor's status callback (or polling) moves the row to
  `SUCCESS`/`FAILED`.
- Paystack stays the default for naira bank payouts. Anchor payouts are for orders paid in USDC, so
  we don't have to sell USDC for naira ourselves.

New module: `src/payments/anchors/` with `sep10.client.ts`, `sep24.client.ts`, `sep38.client.ts`,
`sep31.client.ts` and one `AnchorProvider` per anchor, chosen by config.

## 8. Admin console

- **Escrow queue** (`GET /admin/escrow`): add provider, USDC amount, rate and an explorer link per row. Retry
  works as today.
- **Unmatched deposits** (new): list, attach to an order, or refund to an address and memo. Audit-logged.
- **Treasury panel** (new, read-only): Operating USDC and XLM balances, USDC owed to pending payouts,
  float-limit alerts, and FX gain/loss to date (naira held vs USDC value at today's rate).
- **Overview**: the escrow totals are still correct because `amount` stays in naira. Add "Paid by Stellar" next to
  the totals.
- Alerts (`AlertsService`): unmatched deposit, low XLM, low USDC float, float above max, watcher not running
  for more than 5 minutes.

## 9. Security checklist

- Operating secret only in the secrets manager. Loaded once and never logged. Redact it in error serializers.
- Treasury is multisig and offline. The API has no Treasury key.
- Every payment from the API goes through `EscrowService.execute()`. There is no other code path that signs.
- Check asset code **and issuer** on every incoming payment. Fake "USDC" from other issuers exists.
- Only accept `successful` transactions. Never trust amounts from the client. Settle only from what the watcher sees.
- Rate limits on `pay`, `check-address` and `stellar-intent`.
- Stellar payout addresses are covered by the same change-alert emails and verified-profile rules as bank accounts.
- Daily payout cap per payee and overall (`STELLAR_DAILY_PAYOUT_MAX_USDC`). Payouts above it wait for admin approval.

## 10. Testing

**Unit (vitest, Horizon mocked):**
- `money.ts`: rounding up and down, stroop conversion, refund shares, no float drift.
- Settle: exact, overpaid, underpaid, late within tolerance, late and short, order cancelled, replay of the same hash,
  two watchers racing on the same payment.
- Watcher: wrong asset, wrong issuer, no memo, unknown memo, failed transaction, outgoing payment ignored, cursor saved only after success.
- Payout: success, `op_no_trust`, `op_underfunded`, timeout → stays pending → reconciler confirms, timeout → reconciler
  fails after `maxTime` → retry builds a new transaction, retry blocked while pending.
- Refund share for partial dispute refunds.

**Testnet end-to-end (`scripts/stellar-testnet-e2e.ts`):**
1. Create customer and payee accounts with Friendbot. Add USDC trustlines. Get testnet USDC from Circle's faucet.
2. Create and quote an order, pay through the API, send the payment, and check the order is `PAID` with a HOLD.
3. Complete the order and check that the USDC payout arrived at the payee.
4. Open and resolve a dispute with a partial refund, and check the USDC refund share.
5. Send a payment with no memo and check that it shows up in unmatched deposits.

The existing e2e suite (`test/reviews-notifications.e2e-spec.ts`) gets a Stellar variant that uses a fake `StellarService`,
just as it fakes Paystack.

## 11. Delivery order and rough sizing

Rough estimates for one backend developer and one frontend developer. Firm them up after Phase 0.

| Step | Work | Estimate |
| --- | --- | --- |
| 0 | Legal advice, FX policy, rate source, create testnet and mainnet accounts, secrets manager | 1–2 weeks (mostly waiting) |
| 1a | Migration, config, `StellarService`, `money.ts`, `FxRateService` | 3 days |
| 1b | Intents, `pay()` branch, settle, watcher plus reconciler | 4–5 days |
| 1c | Refunds through `execute()`, unmatched deposits plus admin | 3 days |
| 1d | Checkout UI, wallets kit, QR, socket status, i18n | 4–5 days |
| 1e | Tests plus testnet e2e | 3 days |
| 2 | Profile fields, address check, safe submit plus reconciler, payout UI | 1.5 weeks |
| 3 | Anchor selection, SEP-10/24/38/31 clients, one anchor end to end | 2–3 weeks after an anchor is signed |
| 4 | Security review, mainnet dry run with small amounts, runbook, launch behind the flag to a few customers | 1 week |

**Launch gates:** testnet e2e passes, a mainnet dry run with about $5 orders covers pay → payout → refund,
alerts are confirmed to fire, the runbook (key rotation, sweep, stuck payout, unmatched deposit) is written,
and legal sign-off is on file.

## 12. Files touched (summary)

**API**
- `src/payments/stellar/*` (new), `src/payments/anchors/*` (Phase 3, new)
- `src/payments/payments.module.ts`, `payments.controller.ts`: `methods` and `check-address` endpoints
- `src/escrow/entities/escrow-transaction.entity.ts`: provider columns
- `src/escrow/escrow.service.ts`: `recordHold` metadata, `execute`/`retry` branch on provider
- `src/orders/orders.service.ts`: `pay()` method switch, settle reuses the `confirmPayment` transaction pattern
- `src/orders/orders.controller.ts`: `stellar-intent` endpoint, `method` in the pay DTO
- `src/tailors/entities/tailor-profile.entity.ts`, `src/merchants/entities/merchant-profile.entity.ts` and their DTOs
- `src/common/payout-account.ts`: new payout fields, change notice
- `src/admin/*`: unmatched deposits, treasury panel, escrow queue columns
- `src/database/migrations/<ts>-StellarPayments.ts`
- `README.md`, `.env.example`, `docs/orders-payments-ai-contract.md` (add a "Payments — Stellar" section once built)

**Web**
- `src/components/payments/StellarPay.tsx` (new), `src/app/orders/checkout/page.tsx`, `src/app/orders/[id]/page.tsx`
- `src/lib/payments.ts`, `src/lib/orders.ts`, `src/types/index.ts`
- `src/components/onboarding/verification/bank.tsx`
- `src/app/admin/*`: unmatched deposits and treasury pages
- `src/i18n/dictionaries/*`
