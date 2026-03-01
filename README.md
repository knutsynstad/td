# Castle Game (td)

Tower Defense game for Reddit via Devvit web.

## Prerequisites

Node.js v22, npm

## Setup

```bash
npm install
npm run login   # Devvit auth
```

## Commands

- `npm run dev` – Playtest locally
- `npm run build` / `npm run deploy` / `npm run launch` – Build, upload, or publish
- `npm run type-check` / `npm run lint` / `npm run test` – Quality checks

## Structure

- `src/server` – Backend (Hono, tRPC, serverless)
- `src/client` – Frontend (Three.js, Vite, runs in iframe)
- `src/shared` – Shared types and code

See [AGENTS.md](AGENTS.md) for architecture and conventions.
