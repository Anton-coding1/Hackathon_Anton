# ExitZero · Adversarial building resilience lab

Gemini attacks a floor plan, Gemini proposes costed fixes, and a deterministic graph **judge** decides what actually works. The loop runs until the building is **certified fault-free**: no combination of up to N blocked doors, stairs or lifts strands anyone.

Built for the Gemini Halloween Hackathon. Original team scaffold and workstream notes: [INTEGRATION.md](INTEGRATION.md) and the four area folders.

## Run it

```bash
npm install
cp .env.example .env.local   # add GEMINI_API_KEY from https://aistudio.google.com
npm run dev                  # http://localhost:3000
npm test                     # 28 engine/agent tests
```

Without a key everything still works: the attacker and defender switch to clearly labelled deterministic agents, and costs use built-in indicative rates.

## What's in the app

| Page | What it does |
| --- | --- |
| `/` | Landing page with a live 3D demo (pick a building and scenario), method, upload |
| `/lab?b=clinic` · `/lab?b=industrial` | The lab: 3D model, autopilot, constraints, judge, report, plan download |
| `/lab?b=custom` | Your uploaded building (JSON, or a floor-plan image/PDF read by Gemini) |
| `?autoplay=1` | Starts the autopilot automatically |

**Autopilot:** attacker invents a blockage → engine simulates → defender proposes a fix → cost model re-prices it → judge re-solves the failure and every stored regression → repeat. When the attacker runs out of ideas, an exhaustive engine sweep checks every combination of up to N failures and feeds any remaining weakness back in. It ends with a resilience report: each scenario found and the change introduced to fix it (e.g. a new staircase or evacuation lift).

**Lifts:** lifts are a connection type. Non-evacuation lifts are recalled in a fire alarm, so you can assume lifts are cut off in every scenario; an evacuation lift (or secondary power on an existing lift) keeps working.

**Cost model:** `/api/cost` uses Gemini with Google Search grounding to fetch current UK unit rates with sources; every proposal is re-priced from those rates, not the AI's own number.

**Downloads:** estate-agent / architect style floor plans (SVG/PNG) with verified changes, escape routes, room sizes in m and ft, a cost schedule naming the scenario each change resolves, and the fault-free certificate.

## Code map

```
src/contracts/types.ts      shared types (Connection.kind / evacuationLift are optional additions)
src/engine/                 simulate, findAttacks, certify, auditRepair, resilienceFingerprint + tests
src/agents/ + api/agents    Gemini attacker/defender: structured output, validation, retries
src/app/api/cost            live construction rates via Gemini + Google Search
src/app/api/extract         floor-plan image/PDF → building graph via Gemini
src/cost/costModel.ts       rate table and repair pricing
src/data/                   Blackwood Hall (clinic) and Northfield Works (industrial) + floor plans
src/scene/                  React Three Fiber model: walls, glazing, stairs, lift shafts, particle flows
src/dashboard/              lab UI, controller, autopilot, stress test, report, plan export
src/landing/                landing page and upload
```

Connectivity model of fictional buildings: not a fire risk assessment, building-regulations check or evacuation-time model.
