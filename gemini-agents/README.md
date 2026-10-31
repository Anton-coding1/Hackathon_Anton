# Gemini agents

Own Gemini model calls, prompts and tool adapters. Agents propose actions; the simulation validates and applies them.

## Suggested layout

- `src/`: server-side orchestration and Gemini client wrapper.
- `prompts/`: versioned instructions and structured output definitions.
- `tools/`: allowlisted adapters for simulation commands and state queries.
- `tests/`: mocked responses, malformed output and timeout cases.
- `fixtures/`: example contexts and expected validated proposals.

Create these subdirectories as implementation arrives.

## Integration

Follow [INTEGRATION.md](../INTEGRATION.md). Consume snapshots and return a command proposal with request ID and the state tick it used. Never mutate simulation state directly. Validate model output against the agreed action allowlist, types and parameter bounds. Treat model text as untrusted input.

Keep `GEMINI_API_KEY` server-side in a local environment variable. Document the selected model and SDK version when implemented; do not hard-code credentials or expose them to browser bundles.

## First milestone

Use a mock agent to propose one supported action from a fixture snapshot, then replace the mock with a real model adapter. Add bounded retries, timeouts, cancellation and a no-action fallback. Keep live API tests opt-in and document quotas and cost limits.

## Handoff

Record owner, setup/run/test commands, model configuration, tool schemas, prompt versions and fallback behaviour here. Provide a mock mode so other areas can develop without API access.
