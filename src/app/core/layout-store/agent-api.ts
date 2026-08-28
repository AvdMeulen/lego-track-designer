import { AgentLayoutReport } from './agent-report';
import { AgentGenerateOptions, AgentSceneId, AgentSetupInput } from './agent-setup';

export interface LegoTrackAgent {
  readonly version: string;
  readonly scenes: readonly AgentSceneId[];
  report(): AgentLayoutReport;
  setup(options: AgentSetupInput): AgentLayoutReport;
  generate(options?: AgentGenerateOptions): Promise<AgentLayoutReport>;
}

declare global {
  interface Window {
    legoTrackAgent?: LegoTrackAgent;
  }
}

export {};
