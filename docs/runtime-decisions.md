# Runtime Decisions

## Removed Unused Subsystems

The following modules were removed because they were not referenced by production runtime code or tests:

- `src/game/cohortSimulation.ts`
- `src/game/cohorts.ts`
- `src/game/UpgradeManager.ts`
- `src/utils/WaypointCache.ts`

## Rationale

- Keep a single authoritative runtime path and avoid parallel, unintegrated systems.
- Reduce maintenance overhead and architectural ambiguity.
- Lower refactor risk while decomposing `main.ts` into explicit systems.

If cohort simulation or worker-based upgrades are reintroduced later, they should land behind active integration tests and explicit feature flags.
