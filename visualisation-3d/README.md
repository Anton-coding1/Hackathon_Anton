# 3D visualisation

Render the authoritative simulation state as a scene. Keep rendering and camera state separate from numerical models.

## Suggested layout

- `src/`: scene setup, render loop and state adapter.
- `assets/`: models, materials and textures; document source and usage rights.
- `tests/`: state adapter checks and visual smoke scenarios.

Create these subdirectories as implementation is added; this README anchors the workstream.

## Interface and boundaries

Consume versioned state snapshots defined in [INTEGRATION.md](../INTEGRATION.md). Use entity IDs as stable scene keys and map metres to scene units explicitly. Interpolate visually without changing simulation values. Send user actions through dashboard commands; never update simulation internals directly.

## First milestone

Render a fixture containing two entities, update their positions from a second snapshot, and handle empty, stale and error states. Expose a small mount/update/dispose interface to the dashboard and clean up resources on disposal.

## Handoff checklist

Record owner, chosen stack, install/run/test commands, asset sizes and supported browsers here. Agree coordinate orientation with simulation before importing assets.
