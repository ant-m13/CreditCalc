# Contributing

## Local Setup

Requirements:

- Node.js 22
- pnpm through Corepack

```bash
corepack enable
pnpm install
pnpm dev
```

## Checks

Run the same checks as CI before opening a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For dependency security checks:

```bash
pnpm audit --prod
```

## Issues and Pull Requests

Use the GitHub issue forms for bug reports and feature requests. For calculation bugs, include minimal synthetic loan parameters and avoid real personal data.

Pull requests should follow the repository PR template: describe what changed, why it changed, how it was checked, and whether calculation, import/export, sharing, or local-storage compatibility is affected.

## Calculation Changes

Changes in `src/loanEngine` should include focused regression tests. Prefer small tests that capture the business rule being changed: dates, rounding, payment order, early repayment strategy, grace period behavior, or import compatibility.

## Privacy

Do not commit real loan documents, real exported JSON backups, or private shared calculation links. Use synthetic data in tests and examples.
