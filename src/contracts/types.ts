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
