# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately**, using GitHub's [private vulnerability reporting](https://github.com/Kevin-The-Cyber-Coder/GoFlow/security/advisories/new) (**Security → Advisories → Report a vulnerability**). Do not open a public issue, and do not include an exploit in a pull request.

If you cannot use GitHub advisories, email **kevineniyomurinzi@gmail.com** with `GoFlow security` in the subject.

A useful report contains:

- the affected endpoint, commit or file,
- the impact you believe it has (for example: reading another workspace's invoices),
- minimal reproduction steps, ideally a failing request or test,
- whether the issue is already public anywhere.

## What to expect

| Stage                           | Target                               |
| ------------------------------- | ------------------------------------ |
| Acknowledgement of the report   | 3 working days                       |
| Initial assessment and severity | 10 working days                      |
| Fix or mitigation plan          | 30 days for high and critical issues |

This is a single-maintainer project, so these are best-effort targets rather than a contractual SLA. You will be credited in the advisory and the release notes unless you ask not to be.

Please give a fix a reasonable window before public disclosure. If a fix is not forthcoming, tell me — coordinated disclosure is preferred over silence, and I would rather publish an advisory with a workaround than leave users exposed.

## Supported versions

GoFlow is pre-1.0 and ships from `main`. Security fixes land on `main` and are released as a new patch version; older commits are not maintained.

## Scope

In scope:

- authentication and session handling (`/api/v1/auth`), including refresh token rotation and replay handling,
- authorisation and tenant isolation (any way to read or modify another workspace's data),
- injection, request smuggling and mass-assignment issues in request validation,
- money-handling defects that let a client pay less than the amount owed, or an invoice total disagree with its line items,
- secrets or personal data exposed through logs, error responses or the repository.

Out of scope:

- reports that require an already-compromised machine, browser extension or database access,
- hardening items listed below as known gaps,
- denial of service by volume against a development server,
- findings from automated scanners with no demonstrated impact,
- social engineering.

## Current security model

Worth knowing before you test:

- **Passwords** are hashed with bcrypt. Access tokens are short-lived HS256 JWTs (15 minutes by default); the signing secret must be at least 32 characters in production or the process refuses to start.
- **Refresh tokens are opaque and stored hashed.** Each refresh rotates the token; replaying a rotated token revokes the entire token family, on the assumption that it was stolen.
- **Every tenant-owned query filters on the workspace resolved from the request**, and a resource belonging to another workspace returns `404` rather than `403` so ids cannot be used to probe for existence.
- **All request bodies and query strings are validated with Zod** before they reach a service.
- **Money is integer minor units throughout**; no floating point touches an amount.
- **Security headers (helmet), an explicit CORS allowlist and per-IP rate limiting** are applied to every API request. Cross-origin browser access is denied unless the origin is listed in `CORS_ORIGINS`; authentication endpoints have a stricter budget than the rest of the API; the health check is exempt.

## Known gaps

These are tracked, not surprises:

- **Rate-limit counters live in process memory.** Each API instance counts separately, and a restart clears them. Running more than one instance behind a load balancer needs a shared store (Redis) before the limits mean what they say.
- No CSRF protection, because authentication is a bearer token rather than a cookie.
- No email verification requirement for actions beyond account creation, and no outbound email at all yet.
- No dependency scanning beyond Dependabot updates.
- PostgreSQL row-level security is not used; tenant isolation is enforced in application queries.

## For contributors

Do not add a dependency, a new endpoint or a schema change that widens access without tests covering the permission boundary and cross-workspace isolation. Run `npm run test:integration` before opening a PR that touches authorisation.
