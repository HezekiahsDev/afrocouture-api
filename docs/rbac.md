# Access control (RBAC)

Who can call what, and whose data they can touch. `test/rbac.e2e-spec.ts` checks this
table; update both together.

## How it works

1. **Deny by default.** `JwtAuthGuard` and `RolesGuard` are registered globally (`APP_GUARD`
   in `app.module.ts`). Every HTTP route needs a valid access token unless it carries `@Public()`.
2. **The account is re-read on every request.** `JwtStrategy` loads the user row for the token's
   `sub`. The **role comes from the database, not the token**, so a role change or a forged
   `role` claim has no effect. A suspended account gets `401 { code: 'ACCOUNT_SUSPENDED' }`, and an
   unverified account gets `401 { code: 'EMAIL_NOT_VERIFIED' }`, even with an unexpired token.
3. **Roles.** `@Roles(...)` on a handler or controller limits it to those roles. Otherwise the
   caller gets `403`. A route without `@Roles` is open to any signed-in role.
4. **Ownership is checked in the service, never in the controller.** Services always scope
   queries by the caller (`where: { userId: user.id }`) or check membership
   (`assertCustomer`, `assertTailor`, `viewerOf`, `ChatService.requireMember`). Someone else's
   resource answers `404` (orders, AI designs) or `403` (chat, fabrics), so ids can't be probed.
5. **Public responses are built from explicit allow-lists** (`toPublicTailor`, `toPublicFabric`,
   `listReviews`). Never return an entity from a public route.
6. **WebSockets.** The `/chat` gateway authenticates during the handshake with the same rules.
   It re-checks the account status before each `join_order` and `send_message`, and it
   disconnects every socket of a user when the in-process event `user.suspended` (`{ userId }`)
   is emitted. The global HTTP guards skip non-HTTP contexts.

### Account status

| Status | Sign-in | Refresh | Existing access token | Sockets |
| --- | --- | --- | --- | --- |
| `active` (verified) | ✓ | ✓ | ✓ | ✓ |
| suspended (anything but `active`) | 403 `ACCOUNT_SUSPENDED` | 401 `ACCOUNT_SUSPENDED` (refresh token revoked) | 401 `ACCOUNT_SUSPENDED` | refused at handshake; open sockets dropped on next action or `user.suspended` |
| unverified | 403 `EMAIL_NOT_VERIFIED` | — | 401 `EMAIL_NOT_VERIFIED` | refused |

When you build account suspension, set `status` and then
`events.emit('user.suspended', { userId })` (`USER_SUSPENDED` in `chat.service.ts`).

### Admin accounts

- Admins are created only with `pnpm admin:create` on the server.
- `RegisterDto.role` accepts only customer, tailor or merchant.
- Sign-up never overwrites an existing admin row, even an unverified one.
- `PATCH /users/me/role` refuses admins.

## Route matrix

Legend:
- **P**: public, no token.
- **any**: any signed-in, active, verified account.
- **C / T / M / A**: customer, tailor (artisan), merchant, admin.
- **own**: only the caller's own data. The service scopes by user.

### Auth & account

| Route | Who | Notes |
| --- | --- | --- |
| `POST /auth/register`, `verify-email`, `resend-verification`, `login`, `refresh`, `forgot-password`, `reset-password` | P | Rate-limited. Messages don't reveal whether an email exists. |
| `GET /auth/me`, `POST /auth/logout` | any | `me` never includes `passwordHash` or `refreshTokenHash` (`select: false`). |
| `PATCH /users/me` | any (own) | Name and phone only. |
| `PATCH /users/me/role` | C, T, M (own) | Only before the role is committed: `409 ROLE_LOCKED` once a tailor or merchant profile has been submitted or any order exists. |

### Catalogue (public)

| Route | Who | Notes |
| --- | --- | --- |
| `GET /`, `GET /health` | P | |
| `GET /tailors`, `GET /tailors/:id` | P | Approved artisans only. No KYC, bank, address or `userId` fields. |
| `GET /tailors/:id/reviews` | P | Hidden reviews excluded. Reviewer shown as first name and last initial. |
| `GET /fabrics`, `/fabrics/categories`, `/fabrics/:id` | P | Published fabrics from approved merchants. The merchant summary has no CAC or bank fields. |
| `GET /styles` | P | |
| `GET /payments/banks` | P | Static Paystack bank list. |
| `POST /payments/paystack/webhook` | P | Requires a valid `x-paystack-signature` (HMAC-SHA512 of the raw body), otherwise 401. |

### Role workspaces

| Route | Who | Notes |
| --- | --- | --- |
| `GET/PUT /tailors/me/profile`, `POST /tailors/me/submit` | T (own) | |
| `GET/PUT /merchants/me/profile`, `POST /merchants/me/submit` | M (own) | |
| `GET /fabrics/mine`, `POST /fabrics` | M (own) | Creating a fabric needs an approved merchant profile. |
| `PATCH/DELETE /fabrics/:id` | M (own) | Another merchant's fabric returns 403. |
| `GET/PUT /measurements/me` | C (own) | Artisans see a snapshot on each order instead. |
| `GET /surveys/me`, `/surveys/me/status`, `PUT /surveys/me/answers`, `POST /surveys/me/complete`, `/surveys/me/dismiss` | C, T, M (own) | The form comes from the caller's database role (`src/surveys/definitions`). Answers to another role's questions, or to questions hidden by earlier answers, get 400 `SURVEY_INVALID_ANSWER`. |
| `GET /payments/resolve-account` | T, M | For payout forms. Limited to 20 per hour per user. |
| `POST /uploads?purpose=` | depends on purpose | See the uploads table below. Limited to 60 per hour per user. |
| `GET/PUT/DELETE /saved…` | any (own) | |
| `/ai-studio/*` | any (own) | Designs are scoped by `userId`; another user's design returns 404. Daily quota per user. |
| `GET /notifications`, `/unread-count`, `POST /notifications/read` | any (own) | Marking read only touches the caller's rows. |

#### Uploads

| Purpose | Roles |
| --- | --- |
| `tailor-kyc`, `tailor-portfolio` | T |
| `merchant-verification`, `fabric` | M |
| `fit-photo` | C |
| `chat` (also order reference images) | C, T |

### Orders, chat & reviews

`viewerOf(user, order)` resolves the caller's relationship to an order:

| Viewer | Condition | Sees |
| --- | --- | --- |
| admin | role A | Everything, including escrow transactions. |
| customer | `order.customerId` | The full order. |
| tailor | `order.tailorUserId` | The full order, including the fit snapshot and delivery address. |
| merchant | Owns a line **and the order is paid** | Their fabric lines, the atelier's shipping address, status and fabric events only. **Never** the customer's identity, brief, reference images, measurements or address. The order list gives merchants `customer: { id: null, fullName: null }` and `referenceImageUrls: []`. |
| anyone else | | 404 |

| Route | Who |
| --- | --- |
| `GET /orders`, `GET /orders/:id` | any. The list is scoped to the caller's role; detail goes through `viewerOf`. |
| `POST /orders` | C |
| `POST /orders/:id/quote`, `decline`, `milestone`, `deliver`, `items/:itemId/receive`, `review/reply` | T, must be the order's tailor (else 404) |
| `POST /orders/:id/cancel`, `pay`, `verify-payment`, `approve`, `dispute`, `review` | C, must be the order's customer (else 404) |
| `POST /orders/:id/items/:itemId/ship` | M, must own the line (else 404) |
| `GET/POST /orders/:id/messages`, socket `join_order` / `send_message` | The order's customer or tailor only. Merchants, admins and others get 403. |

### Admin

Every `/admin/*` route has `@Roles(ADMIN)` at controller level (`src/admin/admin.controller.ts`,
`src/surveys/admin-surveys.controller.ts`).
Non-admins get 403, anonymous callers 401 (`test/admin.e2e-spec.ts`).

| Route | Notes |
| --- | --- |
| `GET /admin/overview` | Counts, money, queues and the last 30 Lagos days. |
| `GET /admin/verifications`, `PATCH /admin/tailors/:id/review`, `PATCH /admin/merchants/:id/review` | Audited (`verification.approve` / `verification.reject`). |
| `GET /admin/users`, `GET /admin/users/:id` | Never returns password or refresh-token hashes. |
| `POST /admin/users/:id/suspend`, `POST /admin/users/:id/reactivate` | Not on yourself or any admin (403). Suspending revokes the refresh token, closes sockets and blocks every request. Audited. |
| `GET /admin/orders`, `GET /admin/orders/:id` | Any order. |
| `GET /admin/orders/:id/messages` | Read-only chat. Admins are never members and can't post. |
| `POST /admin/orders/:id/resolve` | Audited (`dispute.resolve`). |
| `GET /admin/escrow?status=…\|all`, `POST /admin/escrow/:id/retry` | Retry audited (`payout.retry`). |
| `GET /admin/reviews`, `PATCH /admin/reviews/:orderId` | Audited (`review.hide` / `review.unhide`). |
| `GET /admin/fabrics`, `PATCH /admin/fabrics/:id` | Unpublishing locks the listing: the merchant gets 409 `FABRIC_MODERATED` if they try to republish. Audited (`fabric.publish` / `fabric.unpublish`). |
| `GET /admin/audit` | The admin action log, newest first. |
| `GET /admin/surveys`, `/admin/surveys/:surveyId`, `/admin/surveys/:surveyId/responses`, `/admin/surveys/responses/:id` | Read-only survey results (`src/surveys/admin-surveys.controller.ts`). |
| `GET /admin/surveys/:surveyId/export.csv` | Includes names and emails. Formula-like cells are neutralised. Audited (`survey.export`). |

## Conventions for new endpoints

1. Do nothing for "signed-in only": the global guard already requires a token.
2. Add `@Public()` only when anonymous access is intended. Shape the response with an
   allow-list mapper.
3. Add `@Roles(...)` whenever only some roles should call the route.
4. Pass `@CurrentUser()` to the service and scope every query by it. Answer 404 for resources that
   exist but aren't the caller's.
5. Rate-limit anything that sends email, calls a paid or third-party API, or can be used to probe
   accounts (`@RateLimit`).
6. Add the route to this table and a case to `test/rbac.e2e-spec.ts`.

## Known follow-ups

- **Uploaded files are public Cloudinary URLs.** KYC ID documents, CAC certificates and
  customers' fit photos are delivered as ordinary `upload`-type assets. Anyone with the
  (unguessable) URL can open them. Store these purposes as `authenticated` assets and
  return short-lived signed URLs to the owner and admins only. This needs a matching change in
  the web upload and preview flow.
- **Admin role changes.** There is no endpoint to change a user's role or create admins over
  HTTP, deliberately. Admins come only from `pnpm admin:create`.
