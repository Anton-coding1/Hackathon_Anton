# Gemini Halloween Hackathon

A shared workspace for four parallel workstreams. This scaffold documents boundaries and proposed integration contracts; implementation and stack choices are still to be agreed by the team.

| Area | Directory | Responsibility |
| --- | --- | --- |
| 3D visualisation | [visualisation-3d](visualisation-3d/) | Render simulation state, scenes, animation and user interaction |
| Simulation mathematics | [simulation-mathematics](simulation-mathematics/) | Models, numerical solvers, assumptions and deterministic state |
| Gemini agents | [gemini-agents](gemini-agents/) | Prompts, tools, structured decisions and model integration |
| Interactive dashboard / integration | [dashboard-integration](dashboard-integration/) | Controls, metrics, service adapters and end-to-end orchestration |

## Getting started

1. Read your area README and [shared integration conventions](INTEGRATION.md).
2. Agree the smallest demo scenario and data contract together. Start with fixture data so work can proceed independently.
3. Add implementation under the suggested subdirectories in your area. Record actual install, run and test commands in that README when a stack is selected. There is no runnable application yet.
4. Deliver one vertical slice: dashboard input → simulation → state snapshot → 3D view and metrics; add agent proposals through the same validated command boundary.

## Team workflow

- Use short branches: `visualisation/<topic>`, `simulation/<topic>`, `agents/<topic>` or `integration/<topic>`.
- Open small pull requests with the behaviour changed, how to run it, and checks performed. Coordinate shared-contract changes with affected workstreams before merging.
- Keep existing work in place; avoid unrelated moves or rewrites. Pull current main before starting and before merging.
- Each area should add focused checks for its public interface and document its owner and dependencies.
- Keep API keys on the server in local environment variables. Commit only placeholder configuration examples; never keys, local .env files, dependency caches or generated build output.
- Choose licensing with the team before adding a licence.
