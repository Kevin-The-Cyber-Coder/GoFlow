# Security policy

## Reporting a vulnerability

Do **not** open a public issue, pull request or discussion for a security
problem.

Use GitHub's private vulnerability reporting on this repository
("Security" → "Report a vulnerability"). Include:

- what is affected and where (endpoint, module, commit),
- steps to reproduce, ideally with a minimal request,
- the impact you believe it has,
- any suggested fix.

You can expect an acknowledgement within 72 hours and an assessment within seven
days. Please allow time for a fix and release before public disclosure.

## Scope

In scope:

- authentication, session and token handling,
- authorisation and workspace-level data isolation,
- injection, XSS, CSRF and request forgery,
- file upload handling,
- exposure of personal or financial data.

Out of scope:

- findings that require a compromised developer machine or CI secrets,
- missing headers on endpoints that return no data,
- automated scanner output with no demonstrated impact.

## Handling

Reports are fixed on a `security/` branch, reviewed privately where possible and
released before the details are published. Credit is given in the release notes
unless the reporter asks otherwise.

## Supported versions

The project is pre-release; only the current `main` branch receives fixes.
