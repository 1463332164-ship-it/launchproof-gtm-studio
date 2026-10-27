import { describe, expect, it } from 'vitest';
import seed from '../../src/data/us-curtain.seed.json';
import { currentFacts, MAX_IMPORT_BYTES, validateProject, validateProjectJson } from '../../src/domain/validation';
import type { Project } from '../../src/domain/entities';

function fixture(): Project {
  const result = validateProject(structuredClone(seed));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.data;
}
function expectCode(input: unknown, code: string) {
  const result = validateProject(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.map(e => e.code)).toContain(code);
}
function quantity(value: number | null, missingReason: string | null = null) {
  return { value, missingReason, unit: 'mm', origin: 'official' as const, sourceRefs: [{ id: 'S01', revision: 1 }], assumptionId: null };
}

describe('identity and version integrity', () => {
  it('rejects duplicate id/revision', () => { const p = fixture(); p.facts.push(structuredClone(p.facts[0]!)); expectCode(p, 'duplicate_version'); });
  it('accepts successive same-id revisions and selects only latest without mutating input', () => {
    const p = fixture(); const next = structuredClone(p.facts[0]!); next.revision = 2; next.supersedesRef = { id: next.id, revision: 1 }; p.facts.push(next);
    const before = JSON.stringify(p); const result = validateProject(p); expect(result.ok).toBe(true); expect(currentFacts(p)).toHaveLength(8);
    expect(currentFacts(p).find(f => f.id === next.id)?.revision).toBe(2); expect(JSON.stringify(p)).toBe(before);
  });
  it('rejects missing earlier revisions', () => { const p = fixture(); p.facts[0]!.revision = 2; expectCode(p, 'missing_revision'); });
  it('rejects reuse of an id across entity kinds', () => { const p = fixture(); p.sources[0]!.id = p.facts[0]!.id; expectCode(p, 'id_kind_collision'); });
  it('rejects missing exact reference revision', () => { const p = fixture(); p.facts[0]!.evidenceLinks[0]!.sourceRef.revision = 8; expectCode(p, 'dangling_ref'); });
  it('rejects references to wrong entity types', () => { const p = fixture(); p.facts[0]!.subjectRef.id = 'S01'; expectCode(p, 'wrong_ref_type'); });
  it('rejects self/cyclic predecessor references', () => { const p = fixture(); p.facts[0]!.supersedesRef = { id: 'F001', revision: 1 }; expectCode(p, 'invalid_predecessor'); });
  it('rejects reversed entity timestamps', () => { const p = fixture(); p.sources[0]!.updatedAt = '2000-01-01T00:00:00Z'; expectCode(p, 'invalid_chronology'); });
});

describe('scope and source boundaries', () => {
  it('rejects replacing Type 1 by a generic variant', () => { const p = fixture(); p.products[0]!.variant = 'Rod'; expectCode(p, 'model_mismatch'); });
  it('rejects using the same product as focal and competitor', () => { const p = fixture(); p.mission.competitorRefs = [p.mission.focalProductRef]; expectCode(p, 'duplicate_product'); });
  it.each(['market', 'currency', 'timeZone'])('rejects out-of-scope mission %s', field => {
    const p = { ...fixture(), mission: { ...fixture().mission, [field]: 'OTHER' } }; expect(validateProject(p).ok).toBe(false);
  });
  it('rejects promoting the generic F007 condition to Type 1 applicable', () => { const p = fixture(); p.facts[6]!.applicability = 'in_scope'; expectCode(p, 'scope_mismatch'); });
  it('rejects source-region mismatch even if product name matches', () => { const p = fixture(); p.sources[0]!.market = 'GLOBAL'; expectCode(p, 'source_scope_mismatch'); });
  it('rejects source model mismatch', () => { const p = fixture(); p.sources[0]!.productScope = ['SB-CURTAIN3-FAMILY']; expectCode(p, 'source_scope_mismatch'); });
  it('rejects archived product in an active mission', () => { const p = fixture(); p.mission.state = 'active'; p.products[0]!.archived = true; expectCode(p, 'archived_product'); });
  it.each(['javascript:alert(1)', 'https://user:password@example.com', 'not-a-url'])('rejects unsafe or invalid source URL %s', url => {
    const p = fixture(); p.sources[0]!.url = url; expect(validateProject(p).ok).toBe(false);
  });
  it('rejects source locator omission', () => { const p = fixture(); p.sources[0]!.locator = ''; expect(validateProject(p).ok).toBe(false); });
});

describe('unknown, conflict and freshness safety', () => {
  it('rejects supported without support and does not mutate to supported automatically', () => {
    const p = fixture(); p.facts[0]!.evidenceLinks = []; expectCode(p, 'missing_support'); expect(p.facts[0]!.evidenceLinks).toEqual([]);
    p.facts[0]!.supportStatus = 'unsupported'; p.facts[0]!.freshness = 'unknown'; expect(validateProject(p).ok).toBe(true);
  });
  it('rejects supported with explicit counterevidence', () => { const p = fixture(); p.facts[0]!.evidenceLinks.push({ ...p.facts[0]!.evidenceLinks[0]!, relation: 'contradicts' }); expectCode(p, 'unresolved_conflict'); });
  it('preserves an explicitly documented conflict instead of selecting a winner', () => {
    const p = fixture(); const fact = p.facts[0]!; fact.evidenceLinks.push({ ...fact.evidenceLinks[0]!, relation: 'contradicts' }); fact.supportStatus = 'contested'; fact.conflictGroupId = 'CF01';
    const result = validateProject(p); expect(result.ok).toBe(true); if (result.ok) expect(result.data.facts[0]!.supportStatus).toBe('contested');
  });
  it('rejects contested with no conflict evidence', () => { const p = fixture(); p.facts[0]!.supportStatus = 'contested'; expectCode(p, 'missing_conflict'); });
  it.each(['index_only', 'inherited_unchecked', 'unavailable'] as const)('does not accept %s as current evidence', status => {
    const p = fixture(); p.sources[0]!.accessStatus = status; expectCode(p, 'freshness_not_supported');
  });
  it('rejects current status without a substantive review date', () => { const p = fixture(); p.facts[0]!.reviewedAt = null; expectCode(p, 'missing_review_date'); });
  it('rejects expired snapshot instead of refreshing it on load', () => { const p = fixture(); p.mission.asOfDate = '2027-03-01'; expectCode(p, 'freshness_not_supported'); });
  it('accepts a day-precision review without inventing a timestamp', () => { const p = fixture(); expect(validateProject(p).ok).toBe(true); expect(p.facts[0]!.reviewedAt).toBe('2026-10-24'); });
  it('rejects nonexistent calendar dates', () => { const p = fixture(); p.mission.asOfDate = '2026-02-30'; expect(validateProject(p).ok).toBe(false); });
  it('rejects current review after asOfDate', () => { const p = fixture(); p.facts[0]!.reviewedAt = '2026-10-25'; expectCode(p, 'future_review'); });
  it('distinguishes null, zero and false', () => {
    const p = fixture(); p.facts[0]!.value = quantity(0); expect(validateProject(p).ok).toBe(true);
    p.facts[0]!.value = quantity(null); expectCode(p, 'unknown_reason');
    p.facts[0]!.value = quantity(null, '未取得尺寸'); expect(validateProject(p).ok).toBe(true);
    p.facts[0]!.value = false; expect(validateProject(p).ok).toBe(true);
    p.facts[0]!.value = null; expectCode(p, 'unknown_reason'); p.facts[0]!.missingReason = '待核'; expect(validateProject(p).ok).toBe(true);
  });
  it.each([Infinity, -Infinity, NaN])('rejects non-finite values %s', value => { const p = fixture(); p.facts[0]!.value = quantity(value); expect(validateProject(p).ok).toBe(false); });
  it('rejects reversed numeric ranges', () => { const p = fixture(); p.facts[0]!.value = { min: 40, max: 10, unit: 'mm', inclusiveMin: true, inclusiveMax: true }; expectCode(p, 'invalid_range'); });
  it('requires assumptions for simulated numeric values', () => { const p = fixture(); p.facts[0]!.value = { ...quantity(1), origin: 'simulated' }; expectCode(p, 'missing_assumption'); });
});

describe('safe JSON boundary without persistence', () => {
  it('parses a valid seed and rejects broken JSON without changing it', () => { const p = fixture(); const json = JSON.stringify(p); expect(validateProjectJson(json).ok).toBe(true); expect(validateProjectJson('{').ok).toBe(false); expect(JSON.stringify(p)).toBe(json); });
  it('rejects unknown schema versions', () => { const p = { ...fixture(), schemaVersion: '2.0.0' }; expect(validateProject(p).ok).toBe(false); });
  it('rejects unexpected fields rather than silently stripping them', () => { expect(validateProject({ ...fixture(), actualSales: 1000 }).ok).toBe(false); });
  it('rejects nonempty future modules instead of claiming validation coverage', () => { expect(validateProject({ ...fixture(), scenarios: [{ name: 'future' }] }).ok).toBe(false); });
  it('measures the size limit in UTF-8 bytes including multibyte content', () => {
    const oversized = JSON.stringify({ note: '中'.repeat(Math.floor(MAX_IMPORT_BYTES / 3) + 1) });
    const result = validateProjectJson(oversized); expect(result.ok).toBe(false); if (!result.ok) expect(result.errors[0]!.code).toBe('size_limit');
    const json = JSON.stringify(fixture()); expect(validateProjectJson(json + ' '.repeat(MAX_IMPORT_BYTES - new TextEncoder().encode(json).byteLength)).ok).toBe(true);
  });
  it('enforces 200 current entities independently of retained revisions', () => {
    const p = fixture(); for (let i = 0; i < 200; i++) p.facts.push({ ...structuredClone(p.facts[0]!), id: `EXTRA-${i}` }); expectCode(p, 'entity_limit');
  });
  it.each([null, [], true, 0, 'text'])('rejects non-project roots %s', value => { expect(validateProject(value).ok).toBe(false); });
});
