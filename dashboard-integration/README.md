# Interactive dashboard / integration

Own the application shell, user controls, metrics and adapters joining simulation, visualisation and Gemini agents.

## Suggested layout

- `src/`: pages, components, application state and orchestration.
- `adapters/`: simulation, renderer and agent boundaries.
- `tests/`: integration smoke tests and UI behaviour.
- `fixtures/`: mock snapshots, command responses and error states.

Create these subdirectories as implementation arrives.

## Integration responsibilities

Follow [INTEGRATION.md](../INTEGRATION.md). Route validated user and agent commands through one authoritative simulation boundary. Display snapshots in both the renderer and metrics from the same tick. Keep API keys in a server-side adapter.

Show loading, empty, paused, stale, disconnected and error states. Provide start, pause, reset and parameter controls only once supported by the simulation contract. Cancel obsolete requests and dispose renderers when leaving a view.

## First milestone

Build a fixture-driven screen with controls, a 3D view and metrics. Replace fixtures one adapter at a time. Verify one input can update the simulation and both displays; verify agent timeout leaves manual controls usable.

## Handoff

Record owner, chosen stack, install/run/test commands, local service ports, environment variable names and demo steps here. Document the agreed transport (in-process, HTTP or streaming) before adding infrastructure.
