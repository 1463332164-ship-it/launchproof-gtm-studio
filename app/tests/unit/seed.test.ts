import { describe, expect, it } from 'vitest';
import seed from '../../src/data/us-curtain.seed.json';
import { validateProject } from '../../src/domain/validation';

describe('LP01 approved seed boundary', () => {
  it('loads exactly two products, seven sources and eight traceable facts', () => {
    const result = validateProject(seed);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.data.products).toHaveLength(2);
    expect(result.data.sources).toHaveLength(7);
    expect(result.data.facts).toHaveLength(8);
    expect(result.warnings.map(w => w.path)).toEqual(['facts.4', 'facts.5', 'facts.6']);
  });
  it('retains F005–F007 uncertainty and five narrowly in-scope snapshot records', () => {
    expect(seed.facts.filter(f => f.applicability === 'in_scope' && f.freshness === 'current')).toHaveLength(5);
    expect(seed.facts.find(f => f.id === 'F005')?.applicability).toBe('unresolved');
    expect(seed.facts.find(f => f.id === 'F006')?.freshness).toBe('stale');
    expect(seed.facts.find(f => f.id === 'F007')?.applicability).toBe('out_of_scope');
  });
  it('does not claim inherited pictures/FAQ were rechecked or invent publication dates', () => {
    expect(seed.sources.filter(s => s.accessStatus === 'inherited_unchecked').map(s => s.id)).toEqual(['S06', 'S07']);
    expect(seed.sources.every(s => s.publishedAt === null && s.pageUpdatedAt === null)).toBe(true);
    expect(seed.sources.every(s => s.provenance.commitSha === 'e162c49d127516909850f65d9436614253aad94c')).toBe(true);
  });
  it('contains no fabricated price, market size, user study, message decision or V2 scenario', () => {
    expect(seed.facts.some(f => /price|revenue|market_share|sales_volume/.test(f.predicate))).toBe(false);
    for (const key of ['insights', 'hypotheses', 'barriers', 'messages', 'decisions', 'scenarios', 'changeEvents'] as const) expect(seed[key]).toEqual([]);
    expect(seed.mission.state).toBe('draft');
    expect(seed.products.every(p => p.manufacturerSku === null)).toBe(true);
  });
  it('distinguishes an explicit exclusion from missing information and retains raw units', () => {
    expect(seed.facts.find(f => f.id === 'F003')?.value).toBe(false);
    expect(seed.facts.find(f => f.id === 'F007')?.value).toMatchObject({ value: 0.625, unit: 'inch', origin: 'official' });
  });
});
