# Simulation mathematics

Own the mathematical model and authoritative simulation state. Keep numerical code independent of the renderer, dashboard and Gemini SDK.

## Suggested layout

- `src/`: models, state transitions and solvers.
- `models/`: equations, assumptions, units and parameter definitions.
- `tests/`: analytical cases, invariants and deterministic regression fixtures.
- `fixtures/`: small versioned inputs and expected snapshots for other areas.

Create subdirectories as implementation arrives.

## Interface

Follow [INTEGRATION.md](../INTEGRATION.md). Expose initialise(config, seed), step(state, commands, dt) and snapshot(state) through an adapter appropriate to the chosen language. Validate commands before applying them. Publish serialisable snapshots with stable entity IDs, explicit units, tick and simulation time.

## First milestone

Implement one documented scenario with a fixed timestep and seed. Provide two consecutive snapshots and verify finite values, time progression and relevant conservation or bounds checks. Document stability limits, invalid inputs and numerical tolerances.

## Handoff

Record owner, dependencies, actual install/run/test commands, default parameters and expected runtime here. Coordinate model or unit changes with visualisation and dashboard owners.
