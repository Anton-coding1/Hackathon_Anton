// Server-only exports. Client components must call /api/agents instead.
export { suggestAttack } from "./attacker";
export type { AttackProposal } from "./attacker";
export { suggestRepair } from "./defender";
export type { RepairProposal, AuditFeedback } from "./defender";
export { AgentError, geminiConfig } from "./gemini";
