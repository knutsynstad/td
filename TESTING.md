# Testing

## Commands

- `npm run test` - run Vitest in watch mode.
- `npm run test:watch` - explicit watch mode.
- `npm run test:run` - run tests once (CI style).

## Test Layout

- Harness-backed integration tests: `tests/server/**/*.integration.test.ts`
- Shared test helpers: `tests/helpers/**/*`
- Colocated unit tests: `src/server/**/*.test.ts`

## How to Choose Test Type

- Use Devvit harness integration tests for user journeys and capability interactions:
  - Redis state transitions
  - Realtime messages
  - Scheduler behavior
  - Route-level request/response flows
- Use colocated unit tests for deterministic branch logic:
  - simulation rules
  - store helpers
  - route guards and error handling

## Conventions

- Name files with `.test.ts` (or `.integration.test.ts` for journey tests).
- Keep tests deterministic and isolated; each Devvit harness test runs in a fresh world.
- Prefer small focused assertions for branch behavior, with one larger assertion per journey test.

## References

- Devvit test harness docs: <https://developers.reddit.com/docs/guides/tools/devvit_test>
