# Contributing

## Setup

```bash
npm install
npm run setup
```

For auth-enabled local testing:

```bash
npm run setup:auth
```

Then configure `apps/server/.env` and run:

```bash
npm run dev
```

## Validate before PR

```bash
npm run build
```

## Pull Request guidelines

- Keep changes focused and small.
- Update docs for behavior or env var changes.
- Do not commit secrets (`.env`, tokens, passwords).
- Prefer adding examples to `.env.example` instead of hardcoded credentials.
