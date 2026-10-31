# Shared integration conventions

Proposed v1 baseline for the four workstreams. Agree domain-specific fields and transport together before implementing. These examples are documentation, not an implemented API.

## Ownership and data flow

Dashboard input or Gemini proposal → command validation → simulation step → immutable snapshot → dashboard metrics and 3D renderer. Simulation is the single authority for world state. Gemini never writes state directly. The dashboard owns orchestration; adapters keep UI, model SDK and numerical code independent.

## Common representation

- Exchange UTF-8 JSON-compatible objects: camelCase fields, stable string IDs, finite numbers, no NaN/Infinity.
- Use SI units: metres, seconds, kilograms and radians. Use a right-handed coordinate frame with +Y up, +X right and +Z toward the viewer. Convert asset coordinates in the renderer adapter.
- Simulation time is numeric seconds from run start; wall-clock timestamps, if needed, use ISO 8601 UTC strings.
- Every run has a unique runId. tick is a non-negative integer increasing once per simulation step. Reset creates a new runId and resets tick/time.
- Consumers ignore older ticks within a run and clear caches on a new runId. Render interpolation must not alter authoritative state.

## Snapshot example

```json
{
  "schemaVersion": "1.0",
  "runId": "demo-001",
  "tick": 0,
  "simulationTimeSeconds": 0,
  "status": "paused",
  "entities": [
    {"id": "entity-1", "positionMetres": {"x": 0, "y": 0, "z": 0}}
  ],
  "metrics": {}
}
```

Required snapshot fields are shown above. status is running, paused or completed. entities may be empty. Define each metric name, unit and meaning before adding it; do not mix display strings into numeric metrics. Add velocity/orientation only with a documented representation.

## Command example

```json
{
  "schemaVersion": "1.0",
  "requestId": "request-001",
  "runId": "demo-001",
  "basedOnTick": 0,
  "source": "dashboard",
  "action": "pause",
  "parameters": {}
}
```

source is dashboard or gemini. Start with an explicit allowlist (for example start, pause and reset); agree support and parameter bounds before enabling an action. Reject unknown actions, invalid types, wrong run IDs and unsupported versions. Reject stale state-dependent proposals with STALE_STATE so callers can refresh. Deduplicate requestId within a run; retries must not apply a command twice.

Return `{ "requestId": "request-001", "accepted": true, "appliedAtTick": 1 }` only after application. On failure return `{ "requestId": "request-001", "accepted": false, "error": { "code": "INVALID_COMMAND", "message": "Unsupported action", "retryable": false } }`. Other agreed codes: STALE_STATE, VERSION_MISMATCH, TIMEOUT and INTERNAL_ERROR. Keep errors safe for display; do not return credentials or raw internal traces.

## Runtime rules

Simulation uses an explicit fixed dt and seed for repeatable fixtures. Model calls run asynchronously outside the stepping loop. Set bounded timeouts/retries and cancellation; if Gemini fails, continue manual operation with a visible status. The team must agree transport, snapshot frequency, maximum payload size and command ordering before wiring services.

## Configuration and compatibility

Keep secrets in server-side environment variables. Configuration examples contain placeholders only. Document local ports and dependency versions once chosen. Additive optional fields can retain v1; breaking changes require a new major schema version and coordinated consumer updates. Unknown optional fields may be ignored; unknown major versions must fail clearly.

## Integration checklist

1. Simulation provides a small initial snapshot and a second deterministic tick as shared fixtures.
2. 3D and dashboard render the same fixture tick and units.
3. One dashboard command updates the simulation and both views.
4. A mocked Gemini proposal passes through the same validation path.
5. Verify malformed commands, duplicates, stale snapshots, reset, timeout and empty entities.
6. Each workstream documents run/test commands; a contract-changing PR updates examples and affected checks together.
