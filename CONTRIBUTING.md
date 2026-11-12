# Contributing to GoFlow

## Ground rules

1. `main` is always deployable. Never commit to it directly.
2. One branch, one concern. A PR that mixes a refactor with a feature is two PRs.
3. Every change ships with tests that fail without it.
4. Financial calculations live on the server. A PR that trusts a client-sent
   total will be rejected.

## Branch naming

`<type>/<short-description>`, where type matches the commit type:

| Prefix      | Use for                               |
| ----------- | ------------------------------------- |
| `feat/`     | New user-visible capability           |
| `fix/`      | Defect repair                         |
| `refactor/` | Behaviour-preserving restructure      |
| `docs/`     | Documentation only                    |
| `chore/`    | Tooling, dependencies, infrastructure |
| `test/`     | Test-only changes                     |
| `security/` | Hardening work                        |

Examples: `feat/invoice-pdf`, `fix/partial-payment-rounding`,
`chore/ci-pipeline`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <imperative summary>

<body explaining what changed and why>

<footer with issue reference, if any>
```

- Scope is the module: `auth`, `clients`, `invoices`, `payments`, `web`, `ci`.
- Write the summary in the imperative mood: "add", not "added".
- The body explains **why**. The diff already explains what.
- One logical change per commit. Do not pad history with cosmetic commits.

## Local checks

Run before opening a PR — CI runs the same commands:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

## Pull requests

Fill in the template. A reviewable PR contains:

- **What changed and why** — the problem, not just the patch.
- **How to test** — exact commands, and what to expect.
- **Screenshots** for any UI change, before and after where relevant.
- **Open questions** — anything you are unsure about, stated plainly.

Keep PRs small enough to review in one sitting. If a feature needs three
sessions of review, split it.

## Review and merge

1. A PR needs a passing CI run and one approving review.
2. Address feedback with additional commits on the same branch. Do not force-push
   over someone's review.
3. Merge with **squash and merge** so `main` keeps one commit per PR.
4. Delete the branch after merge.

## Definition of done

- [ ] Tests cover the change, including the failure paths.
- [ ] `npm run lint`, `typecheck`, `test` and `build` pass.
- [ ] No secrets, credentials or personal data in the diff.
- [ ] Documentation updated when behaviour or setup changes.
- [ ] Migrations are reversible or explicitly documented as one-way.

## Reporting bugs and proposing features

Open an issue before starting significant work so the scope can be agreed first.
For security issues, follow [SECURITY.md](SECURITY.md) instead.
