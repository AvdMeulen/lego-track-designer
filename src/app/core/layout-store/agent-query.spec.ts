import { parseAgentQuery } from './agent-query';

describe('parseAgentQuery', () => {
  function params(values: Record<string, string>): { get(name: string): string | null } {
    return { get: (name) => values[name] ?? null };
  }

  it('reads generate, seed, and parking flags', () => {
    expect(parseAgentQuery(params({ generate: '1', seed: '90', parking: '2' }))).toEqual({
      generate: true,
      seed: 90,
      parking: 2,
      scene: null,
    });
    expect(parseAgentQuery(params({ scene: 'eval' })).scene).toBe('eval');
  });

  it('treats true/yes as generate and ignores junk', () => {
    expect(parseAgentQuery(params({ generate: 'yes', seed: '0', parking: '9' }))).toEqual({
      generate: true,
      seed: null,
      parking: null,
      scene: null,
    });
    expect(parseAgentQuery(params({ generate: 'false' })).generate).toBeFalse();
  });
});
