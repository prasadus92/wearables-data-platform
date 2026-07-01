# Security

Report vulnerabilities to prasad@example.com.

Known, deliberate demo-scope decisions with their hardening plan are
documented in docs/authentication.md (CORS, guest minting rate limits,
stream credential transport, Clerk instance type, webhook event retention).
Secrets live in AWS SSM SecureString in production; the sandbox
API keys are rotated on a regular schedule.
