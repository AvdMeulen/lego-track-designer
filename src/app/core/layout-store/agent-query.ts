import { AgentSceneId, parseAgentScene } from './agent-setup';

export interface AgentQuery {
  generate: boolean;
  seed: number | null;
  parking: 0 | 1 | 2 | null;
  scene: AgentSceneId | null;
}

export function parseAgentQuery(params: { get(name: string): string | null }): AgentQuery {
  return {
    generate: isFlag(params.get('generate')),
    seed: parsePositiveInt(params.get('seed')),
    parking: parseParking(params.get('parking')),
    scene: parseAgentScene(params.get('scene')),
  };
}

export function agentQueryKey(query: AgentQuery): string {
  return `${query.generate ? 1 : 0}|${query.seed ?? ''}|${query.parking ?? ''}|${query.scene ?? ''}`;
}

function isFlag(raw: string | null): boolean {
  if (raw == null) {
    return false;
  }
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function parsePositiveInt(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    return null;
  }
  return Math.floor(value);
}

function parseParking(raw: string | null): 0 | 1 | 2 | null {
  if (raw == null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  if (value === 0 || value === 1 || value === 2) {
    return value;
  }
  return null;
}
