import type {
  DockerRunnerEngine,
  RunnerRuntime,
} from "@/server/office/catalog";

export type ProvisionRunnerInput = {
  agentId: string;
  agentName: string;
  runnerName: string;
  roleLabel: string;
  resourcePool: string;
  engine: DockerRunnerEngine;
};

export type ProvisionRunnerResult = {
  success: boolean;
  runtime: RunnerRuntime;
  image: string;
  host: string;
  healthSummary: string;
  nativeDashboardUrl: string | null;
  errorMessage?: string;
  metadata?: Record<string, string>;
};
