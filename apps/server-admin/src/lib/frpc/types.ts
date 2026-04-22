export const FRPC_PRIMARY_INSTANCE_ID = "primary";

export type FrpcInstanceMeta = {
  id: string;
  name: string;
  isPrimary: boolean;
  configPath: string;
  workDir: string;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
};

export type FrpcInstanceRuntime = {
  desiredRunning: boolean;
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  lastExitCode: number | null;
  lastMessage: string | null;
};

export type FrpcInstanceSummary = {
  serverAddr: string;
  serverPort: string;
  localPort: string;
  remotePort: string;
};

export type FrpcInstanceStatus = FrpcInstanceMeta &
  FrpcInstanceRuntime & {
    running: boolean;
    attached: boolean;
    summary: FrpcInstanceSummary;
  };

export type FrpcInstancesOverview = {
  initialized: boolean;
  platform: string;
  primaryInstanceId: typeof FRPC_PRIMARY_INSTANCE_ID;
  total: number;
  extraCount: number;
  runningCount: number;
  defaults: { local_port: string };
  items: FrpcInstanceStatus[];
};

export type FrpcInstanceDetail = {
  item: FrpcInstanceStatus;
  content: string;
  logs: string[];
};
