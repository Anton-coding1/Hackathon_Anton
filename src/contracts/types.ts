// Shared ExitZero contract. All modules use these exact types.
// Change only with the whole team's agreement.

export type Vec3 = [number, number, number];

export type RoomNode = {
  id: string;
  label: string;
  position: Vec3;
  floor: number;
  kind: "room" | "junction" | "exit";
  stepFreeExit?: boolean;
};

export type Connection = {
  id: string;
  from: string;
  to: string;
  length: number;
  stepFree: boolean;
  floor: number;
  costToAdd?: number;
  /** Optional, additive (v1.1): what the link physically is. Defaults to corridor/door, or stairs if not step-free between floors. */
  kind?: "corridor" | "door" | "stairs" | "lift" | "ramp";
  /** Optional, additive (v1.1): lift designed and powered for evacuation, so it keeps working in a fire alarm. */
  evacuationLift?: boolean;
};

export type Occupant = {
  id: string;
  label: string;
  startNodeId: string;
  requiresStepFree: boolean;
};

export type Building = {
  id: string;
  name: string;
  nodes: RoomNode[];
  connections: Connection[];
  occupants: Occupant[];
};

export type Scenario = {
  id: string;
  name: string;
  blockedConnectionIds: string[];
};

export type Repair =
  | {
      kind: "add_connection";
      connection: Connection;
      cost: number;
    }
  | {
      kind: "unblock_connection";
      connectionId: string;
      cost: number;
    }
  /** Optional, additive (v1.1): several connections built as one change, e.g. an evacuation lift serving every floor. */
  | {
      kind: "add_connections";
      connections: Connection[];
      cost: number;
      label?: string;
    }
  /** Optional, additive (v1.1): bring existing lift connections up to evacuation-lift standard (secondary power, protected lobbies). */
  | {
      kind: "upgrade_lift";
      connectionIds: string[];
      cost: number;
      label?: string;
    };

export type TestResult = {
  scenarioId: string;
  unreachableOccupantIds: string[];
  paths: Record<string, string[]>;
  reachableCount: number;
  totalCount: number;
  explanations: string[];
};

export type RepairAudit = {
  accepted: boolean;
  cost: number;
  budget: number;
  before: TestResult;
  after: TestResult;
  regressions: {
    scenarioId: string;
    beforeUnreachable: number;
    afterUnreachable: number;
    passed: boolean;
  }[];
  reasons: string[];
};

export type FailurePassport = {
  id: string;
  scenario: Scenario;
  result: TestResult;
  repair?: Repair;
  audit?: RepairAudit;
};
