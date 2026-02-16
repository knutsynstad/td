# Performance Baseline

This project includes a reproducible baseline harness for core runtime hotspots.

## How to run

```bash
npm run bench:baseline
```

The benchmark suite currently captures:

- `computeLanePathAStar` latency on a representative obstacle layout
- One-frame motion update cost with 500 mobs
- One-frame motion update cost with 1000 mobs

## Current baseline (local run)

- `pathfinding_ms`: 6.87
- `mob_frame_500_ms`: 6.54
- `mob_frame_1000_ms`: 4.33

Update these values when hardware or algorithmic changes affect performance.
