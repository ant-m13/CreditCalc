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

## Calculation Changes

Changes in `src/loanEngine` should include focused regression tests. Prefer small tests that capture the business rule being changed: dates, rounding, payment order, early repayment strategy, grace period behavior, or import compatibility.

## Privacy

Do not commit real loan documents, real exported JSON backups, or private shared calculation links. Use synthetic data in tests and examples.
