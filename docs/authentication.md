# Authentication

Two credential types, deliberately different in power. Webhooks are a third, separate
mechanism.

## 1. Service key (machine to machine)

A static token configured as `API_AUTH_TOKEN`, accepted on every `/v1` route as
`X-API-Key: <token>`, `Authorization: Bearer <token>`, or `?api_key=<token>` (the SSE
stream uses the query form because EventSource cannot send headers).

- Full access to all users' data. This is the credential for Postman, the YOU(th)
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
  gets or creates the caller's user for that mode and registers it with Junction.
  Idempotent per identity and environment.
- Unset `CLERK_ISSUER` disables this path; the service key keeps working.

The dual model in one sentence: services authenticate with a service key and see
everything; people authenticate as themselves and see only themselves.

## 3. Webhooks

`/webhooks/junction` ignores both credentials above. Inbound events are
authenticated by their Svix HMAC signature, verified against the signing secret of
every registered Junction environment (sandbox and production endpoints both point
at this route). Replays are deduplicated on the Svix message id.

## Production evolution

- Web/mobile sessions: already correct (Clerk, per-user scoping).
- The service key would split per consumer (one per integration, rotatable
  individually) or move to short-lived OAuth client credentials.
- Add rate limiting per credential and audit logging of service-key access to
  user data; both are middleware-level additions.
- The anonymous "Get started" demo path is challenge scope; production onboarding
  would always pass through sign-in, making every client request user-scoped.
