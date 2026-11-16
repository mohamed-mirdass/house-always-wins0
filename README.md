# Royal Spin — Vercel + Supabase

Multiplayer casino using virtual points only: roulette, blackjack, slots, live leaderboard, dealer controls (`/host`), TV display (`/tv`), QR joining and PWA installation. No Redis or Socket.IO server is required.

## Deploy

1. Create or choose your **target** Supabase project. Run `sql/setup.sql` in its SQL Editor. This creates an isolated `royal_spin` schema for private game state and a public, read-only Realtime revision counter. Running the script again preserves existing state.
2. From Supabase **Connect**, copy the **transaction pooler** Postgres connection string (port 6543). Replace its password placeholder; URL-encode special password characters. Use this as `DATABASE_URL`. TLS verification stays enabled. If your environment requires a custom CA, configure `NODE_EXTRA_CA_CERTS`; do not disable verification.
3. In Vercel, import this repository, use the **Other** preset, Node.js **22.x**, repository root directory, and leave build/output overrides unset. The API entrypoint and `vercel.json` route the application to Express. Remove any old output-directory override such as `public`.
4. Add the following environment variables for Production (and Preview if testing a preview):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase transaction pooler connection string; server only |
| `SUPABASE_URL` | Target project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Target project's publishable key (legacy anon key also works); safe for browser use |
| `SESSION_SECRET` | At least 32 random characters; server only; keep stable between deployments |
| `HOST_KEY` | Long random dealer password; server only |
| `PUBLIC_URL` | Canonical HTTPS site URL, used in the joining QR code |
| `CRON_SECRET` | Separate random secret for the optional background scheduler |

Generate secrets individually with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Never use a Supabase service role key in the browser. No service role key is needed by this application.
5. Redeploy and verify `/healthz` returns `ok`. Open `/host` and enter `HOST_KEY`; open `/tv` for the projector and `/` for players.
6. For automatic rounds even when all browsers are closed, enable Supabase `pg_cron` and `pg_net`, create the two Vault secrets described in `sql/scheduler.sql`, then run that script. This makes an HTTP request every five seconds and incurs the corresponding Vercel invocations. Monitor `cron.job_run_details` and `net._http_response` for failures. Without the scheduler, open browsers advance due phases through a two-second heartbeat; with no browsers the game pauses until the next request. Transitions can be a few seconds late; this is not a subsecond scheduler. No wagers are accepted after an expired betting deadline because the server advances the game before processing actions.

The frontend listens to Supabase Realtime for revision changes and fetches an authoritative public/private view through Vercel. The heartbeat also recovers from missed notifications. Ensure the `royal_spin_revision` table is enabled in the `supabase_realtime` publication (the setup script does this).

## Local development

Use a development Supabase project and run the setup SQL there. Copy `.env.example` to `.env`, fill in its values, and set `PUBLIC_URL=http://localhost:3000`.

```sh
npm ci
node --env-file=.env server.js
```

`npm start` works when environment variables are already exported. `npm test` runs engine and embedded Postgres tests without a hosted project.

## Architecture and limits

Each action loads the game inside a Postgres transaction with `SELECT ... FOR UPDATE`, applies the existing JavaScript rules, and commits the complete private state. Requests from different Vercel instances serialize on the same row, avoiding lost balance updates and double settlement. Blackjack decks, pending slot payouts, roulette deadlines and bets survive restarts. No background process, local file writes or in-memory timers are required.

This intentionally retains one small shared game (up to 300 registered players), not a large multiroom platform. A single JSON state row and full leaderboard responses become bottlenecks at high activity; load-test at your expected attendance before an event. Split into per-room/per-player rows for larger deployments.

Player identity is a signed, HttpOnly, SameSite cookie minted on the server; client-supplied IDs are ignored. Players do not need email accounts. Clearing cookies or changing `SESSION_SECRET` loses access to that player; account recovery is not implemented. Dealer authorization is checked on every request. Browser roles cannot access the private schema or modify the revision counter. Only a harmless revision counter is published through Realtime.

Action retries use the same request ID and a durable cached response in the private `royal_spin.requests` table. Monitor its size; archive old entries only when their replay protection is no longer required. Automatic settlement also checks stored phase/payout state, so repeated scheduler invocations cannot pay a round twice.

Existing Upstash/local scores are **not imported automatically**. Export and migrate them separately before switching if they must be retained. Existing browser IDs are replaced by signed sessions. Keep the previous deployment available until you have tested the new deployment with multiple browsers.

## Verification before using the live site

- Join with two separate browser profiles, place concurrent bets, undo, clear and repeat bets.
- Spin from `/host`; verify the TV, leaderboard and both players agree.
- Test blackjack hit/stand/double, slots, refill and dealer resets.
- Enable automatic play, reload during a spin/blackjack hand, and verify balances and pending payouts survive.
- Confirm an incorrect dealer key cannot spin or reset.
- Check Realtime updates, `/healthz`, Vercel logs and scheduler responses.

No hosted database or production deployment is modified by the test suite.
