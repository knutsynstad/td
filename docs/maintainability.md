# Maintainability guardrails

## File size guidance
- Soft cap: keep files under 400 lines.
- Review trigger: split files that exceed 600 lines.
- Prefer extraction by responsibility (rendering, input, placement, AI, UI) before adding new features.

## Module boundaries
- `src/main.ts`: bootstrap and wiring only.
- `src/game`: domain state and orchestration primitives.
- `src/entities`: movement and behavior systems.
- `src/placement`: build/placement rules and wall-line planning.
- `src/physics`: pure collision math.
- `src/effects`: visual-only systems.
- `src/ui`: DOM/UI components and state presentation.

## PR hygiene
- Keep one risk axis per PR: structural extraction or behavior change, not both.
- During extraction, preserve behavior first; queue gameplay tweaks as follow-up PRs.
- Add tests when extracting pure logic (collision, placement math, pathfinding helpers).

## Extensibility checklist
- New feature has a single owning module.
- New public functions have explicit typed inputs/outputs.
- No hidden cross-module mutation without clear API entrypoints.
