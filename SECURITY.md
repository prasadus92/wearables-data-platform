# Security

Report vulnerabilities to prasad@luminik.io.

Known, deliberate demo-scope decisions with their hardening plan are
documented in docs/authentication.md (CORS, guest minting rate limits,
stream credential transport, Clerk instance type, webhook event retention).
Secrets live in AWS SSM SecureString in production; the challenge-period
API keys are scheduled for rotation when the engagement ends.
