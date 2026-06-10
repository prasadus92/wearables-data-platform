# Authentication

Two credential types, deliberately different in power. Webhooks are a third, separate
mechanism.

## 1. Service key (machine to machine)

A static token configured as `API_AUTH_TOKEN`, accepted on every `/v1` route as
`X-API-Key: <token>`, `Authorization: Bearer <token>`, or `?api_key=<token>` (the SSE
stream uses the query form because EventSource cannot send headers).

- Full access to all users' data. This is the credential for Postman, the ExampleHealth
  backend if it integrated with this service, CI smoke tests, and demos.
- Compared in constant time. Stored in SSM SecureString, injected into ECS.
- An empty configured token disables auth entirely; permitted only in local
  development and tests.

## 2. User tokens (people)

Clerk session JWTs from the signed-in web or mobile apps, sent as
`Authorization: Bearer <jwt>`.

- Verified against the Clerk instance JWKS (`CLERK_ISSUER`), RS256, expiry and
  issuer checked. No call to Clerk on the request path; key material is cached.
- **Scoped**: a token only reaches users whose `client_user_id` belongs to its
  identity (`clerk:{sub}` for Demo/sandbox, `clerk:{sub}:production` for Live).
  Anything else returns 404, identical to a missing user, so the API never
  confirms that another account exists.
- Bootstrap: `POST /v1/me` (optional `{"environment": "sandbox"|"production"}`)
  gets or creates the caller's user for that mode and registers it with Aggregator.
  Idempotent per identity and environment.
- Unset `CLERK_ISSUER` disables this path; the service key keeps working.

The dual model in one sentence: services authenticate with a service key and see
everything; people authenticate as themselves and see only themselves.

## 3. Webhooks

`/webhooks/aggregator` ignores both credentials above. Inbound events are
authenticated by their Svix HMAC signature, verified against the signing secret of
every registered Aggregator environment (sandbox and production endpoints both point
at this route). Replays are deduplicated on the Svix message id.

## Production evolution

- Web/mobile sessions: already correct (Clerk, per-user scoping).
- The service key would split per consumer (one per integration, rotatable
  individually) or move to short-lived OAuth client credentials.
- Add rate limiting per credential and audit logging of service-key access to
  user data; both are middleware-level additions.
- The anonymous "Get started" demo path is challenge scope; production onboarding
  would always pass through sign-in, making every client request user-scoped.

## Known limitations and hardening queue

Honest edges of the current setup, in priority order:

1. **The mobile bundle ships the service key.** The guest "Get started" path needs a
   credential to call user-creation, so published mobile bundles embed the service
   key. Acceptable while the audience is small and known; before wide
   distribution, guest creation moves behind a constrained route (rate-limited,
   guest-scoped token in the response, no service key on the client). The public web
   build already ships keyless by design.
2. **Keyless web cannot start guest sessions.** On the public site the guest button
   calls an endpoint it has no credential for; sign-in is the working path. Either
   hide the guest entry on keyless builds or ship the constrained guest route above.
3. **Clerk runs as a development instance.** Fine for the challenge (the dev watermark
   is the only visible artifact); production means a Clerk production instance on an
   owned domain and a key swap.
4. **Signing in after a guest session does not adopt the guest's devices.** The
   service-side remap endpoint is the wired migration path and writes the ledger;
   auto-adoption on sign-in is a product decision with consent implications, made
   deliberately rather than implicitly.
5. **Single service key.** Production splits it per consumer with rotation, plus rate
   limiting and audit logging of service-key access to user data.
6. **Right to erasure is service-side only.** DELETE /v1/users/{id} (service
   credential required) deregisters providers at Aggregator, deletes the Aggregator user,
   and cascades the local user, connections, samples, and device events. End users go
   through support in this version; a self-serve "delete my account" flow would wrap
   the same endpoint. Caveat: ``webhook_events`` rows are payload-matched rather than
   FK'd and survive erasure as the raw ingestion audit log; they carry provider
   identifiers, so a scheduled N-day retention sweep of that table is part of this
   queue.
