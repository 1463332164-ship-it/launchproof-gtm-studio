import { describe, expect, it } from 'vitest';
import seed from '../../src/data/us-curtain.seed.json';
import type { Project } from '../../src/domain/entities';
import { assessEvidence } from '../../src/domain/evidence';
import { evidenceGraph, findAffected, invalidateDependants } from '../../src/domain/provenance';
import { currentFacts, latest, validateProject } from '../../src/domain/validation';
import { archiveEntity, editMission, recordMeaningReview, replaceProject, saveEntity } from '../../src/application/projectCommands';
import { previewImport, readImportFile, serializeProject } from '../../src/infrastructure/importExport';
import { ConflictError, LocalProjectStore } from '../../src/infrastructure/localProjectStore';
import type { LockPort, StoragePort } from '../../src/infrastructure/localProjectStore';

const c = { now: '2026-10-25T02:00:00Z', reason: '合成自动测试，不是用户核查', author: 'ai_assisted' as const };
function fixture(): Project { return previewImport(JSON.stringify(seed)); }
const first = (p: Project) => currentFacts(p).find(f => f.id === 'F001')!;
function personalFixture(p: Project) { return recordMeaningReview(p, 'F001', { ...c, author: 'self' }); }
class MemoryStorage implements StoragePort {
  data = new Map<string, string>(); failKey = ''; denyRead = false;
  getItem(key: string) { if (this.denyRead) throw new Error('SecurityError'); return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { if (key === this.failKey) throw new Error('QuotaExceededError'); this.data.set(key, value); }
}
function storageFixture() {
  const memory = new MemoryStorage(); let queue: Promise<unknown> = Promise.resolve();
  const lock: LockPort = (_name, action) => { const pending = queue.then(action); queue = pending.catch(() => undefined); return pending; };
  return { memory, store: new LocalProjectStore(() => memory, lock) };
}

describe('LP02 mission, commands and immutable history', () => {
  it('AC01 rejects duplicate products and retains input draft', () => {
    const p = fixture(); const draft = { ...p.mission, competitorRefs: [p.mission.focalProductRef] }; const before = JSON.stringify(draft);
    expect(() => editMission(p, draft, 1, c)).toThrow('定位对象'); expect(JSON.stringify(draft)).toBe(before); expect(p.mission.revision).toBe(1);
  });
  it('AC01 rejects non-US task activation without changing original', () => { const p = fixture(); expect(() => editMission(p, { ...p.mission, state: 'active', market: 'CA' }, 1, c)).toThrow(); expect(p.mission.market).toBe('US'); });
  it('activates a valid mission as a new revision and retains original', () => { const p = fixture(); const next = editMission(p, { ...p.mission, state: 'active' }, 1, c); expect(next.mission.revision).toBe(2); expect(next.missionHistory[0]).toEqual(p.mission); expect(next.changeEvents[0]!.affectedRefs).toHaveLength(8); expect(p.mission.state).toBe('draft'); });
  it('AC02 changed focal object invalidates an existing personal review', () => {
    const p = personalFixture(fixture()); expect(assessEvidence(first(p), p).eligibleForClaim).toBe(true);
    const next = editMission(p, { ...p.mission, focalProductRef: p.mission.competitorRefs[0]!, competitorRefs: [p.mission.focalProductRef] }, 1, c);
    expect(assessEvidence(first(next), next).needsReview).toBe(true); expect(next.meaningReviews).toEqual(p.meaningReviews);
  });
  it('AC05 moving assessment date expires effective evidence without rewriting history', () => {
    const p = fixture(); const next = editMission(p, { ...p.mission, asOfDate: '2027-03-01' }, 1, { ...c, now: '2027-03-01T10:00:00Z' });
    expect(next.facts).toEqual(p.facts); expect(assessEvidence(first(next), next).freshness).toBe('stale'); expect(validateProject(next).ok).toBe(true);
  });
  it('rejects future asOfDate relative to the operator Shanghai day', () => { const p = fixture(); expect(() => editMission(p, { ...p.mission, asOfDate: '2026-10-26' }, 1, c)).toThrow('评估日期'); });
  it('rejects stale mission and entity edit versions', () => { const p = fixture(); expect(() => editMission(p, p.mission, 9, c)).toThrow('版本'); expect(() => saveEntity(p, 'facts', first(p), 9, c)).toThrow('版本'); });
  it('adds a source and rejects duplicate/cross-kind IDs', () => {
    const p = fixture(); const src = { ...p.sources[0]!, id: 'S-new' }; const next = saveEntity(p, 'sources', src, null, c);
    expect(latest(next.sources)).toHaveLength(8); expect(() => saveEntity(next, 'sources', src, null, c)).toThrow('ID'); expect(() => saveEntity(p, 'sources', { ...src, id: 'F001' }, null, c)).toThrow('ID');
  });
  it('edits fact conditions as a new revision and old review no longer applies', () => {
    const p = personalFixture(fixture()); const old = JSON.stringify(p); const next = saveEntity(p, 'facts', { ...first(p), conditions: ['仅合成测试条件，非新增真实事实'] }, 1, c);
    expect(first(next).revision).toBe(2); expect(next.facts[0]).toEqual(p.facts[0]); expect(JSON.stringify(p)).toBe(old); expect(assessEvidence(first(next), next).needsReview).toBe(true);
  });
  it('requires a change reason and validates dangling references', () => { const p = fixture(); expect(() => saveEntity(p, 'facts', first(p), 1, { ...c, reason: '' })).toThrow('理由'); const draft = structuredClone(first(p)); draft.evidenceLinks[0]!.sourceRef.id = 'missing'; expect(() => saveEntity(p, 'facts', draft, 1, c)).toThrow('找不到'); });
  it('rejects a false exact-model applicability assertion', () => { const p = fixture(); const f = p.facts[6]!; expect(() => saveEntity(p, 'facts', { ...f, applicability: 'in_scope' }, 1, c)).toThrow('精确型号'); });
  it('AC06 refuses archive of a referenced source, including historical references', () => { const p = fixture(); expect(() => archiveEntity(p, 'sources', 'S01', c)).toThrow('被引用'); expect(p.sources).toHaveLength(7); });
  it('archives and restores unreferenced sources without physical deletion', () => { const p = fixture(); const archived = archiveEntity(p, 'sources', 'S06', c); expect(latest(archived.sources).find(s => s.id === 'S06')!.archived).toBe(true); const restored = archiveEntity(archived, 'sources', 'S06', c); expect(restored.sources.filter(s => s.id === 'S06')).toHaveLength(3); });
  it('archives and restores a fact, retaining the baseline record', () => { const p = fixture(); const archived = archiveEntity(p, 'facts', 'F001', c); expect(currentFacts(archived)).toHaveLength(7); const restored = archiveEntity(archived, 'facts', 'F001', c); expect(first(restored).revision).toBe(3); expect(restored.facts[0]).toEqual(p.facts[0]); });
  it('source edit marks only its dependants and preserves fact/source history', () => { const p = fixture(); const next = saveEntity(p, 'sources', { ...p.sources[0]!, summary: '合成测试摘要' }, 1, c); expect(next.changeEvents[0]!.affectedRefs.map(r => r.id)).toEqual(['F001','F008']); expect(next.facts).toEqual(p.facts); expect(next.sources[0]).toEqual(p.sources[0]); });
  it('AI review is recorded as AI and never qualifies as personal review', () => { const p = recordMeaningReview(fixture(), 'F001', c); expect(p.meaningReviews[0]!.authorType).toBe('ai_assisted'); expect(assessEvidence(first(p), p).eligibleForClaim).toBe(false); });
  it('requires rebind to latest source before semantic review', () => { const p = fixture(); const next = saveEntity(p, 'sources', { ...p.sources[0]!, summary: '合成测试' }, 1, c); expect(() => recordMeaningReview(next, 'F001', c)).toThrow('重新绑定'); });
});

describe('LP02 derived evidence and graph boundaries', () => {
  it.each(['index_only','inherited_unchecked','unavailable'] as const)('AC03 %s never qualifies even with a personal fixture', status => { const p = personalFixture(fixture()); const next = saveEntity(p, 'sources', { ...p.sources[0]!, accessStatus: status }, 1, c); const a = assessEvidence(first(next), next); expect(a.supportStatus).toBe('unsupported'); expect(a.eligibleForClaim).toBe(false); });
  it('AC03 no supporting link remains unsupported, not automatically certified', () => { const p = fixture(); const next = saveEntity(p, 'facts', { ...first(p), evidenceLinks: [] }, 1, c); expect(assessEvidence(first(next), next).supportStatus).toBe('unsupported'); });
  it('AC04 explicit same-scope counterevidence remains contested, both links retained', () => { const p = fixture(); const f = first(p); const next = saveEntity(p, 'facts', { ...f, evidenceLinks: [...f.evidenceLinks, { ...f.evidenceLinks[0]!, relation: 'contradicts' }] }, 1, c); expect(first(next).evidenceLinks).toHaveLength(2); expect(assessEvidence(first(next), next).supportStatus).toBe('contested'); });
  it('AC04 different-model counterevidence is a scope difference, not a conflict winner', () => { const p = fixture(); const f = first(p); const next = saveEntity(p, 'facts', { ...f, evidenceLinks: [...f.evidenceLinks, { ...f.evidenceLinks[0]!, sourceRef: { id: 'S04', revision: 1 }, relation: 'contradicts' }] }, 1, c); expect(assessEvidence(first(next), next).supportStatus).toBe('supported'); expect(assessEvidence(first(next), next).reasons.join()).toContain('范围差异'); });
  it('AC05 source access-date update cannot refresh old historical evidence', () => { const p = fixture(); const next = saveEntity(p, 'sources', { ...p.sources[4]!, accessedAt: c.now }, 1, c); expect(assessEvidence(next.facts[5]!, next).freshness).toBe('stale'); expect(next.facts[5]!.reviewedAt).toBe(p.facts[5]!.reviewedAt); });
  it('AC02/06 generic downstream seam invalidates Message/Decision fixtures, not unrelated nodes', () => {
    const p = fixture(); const nodes = [...evidenceGraph(p), { ref: { id:'MSG-test',revision:1 }, dependencies:[{ id:'F001',revision:1 }],state:'reviewed' }, { ref:{id:'DEC-test',revision:1},dependencies:[{id:'MSG-test',revision:1}],state:'recorded' }, {ref:{id:'unrelated',revision:1},dependencies:[],state:'reviewed'}];
    const before = JSON.stringify(nodes); const after = invalidateDependants(nodes, {id:'S01',revision:2});
    expect(after.find(n => n.ref.id==='MSG-test')!.state).toBe('needs_review'); expect(after.find(n=>n.ref.id==='DEC-test')!.state).toBe('needs_review'); expect(after.find(n=>n.ref.id==='unrelated')!.state).toBe('reviewed'); expect(JSON.stringify(nodes)).toBe(before);
  });
  it('rejects graph cycles rather than looping or accepting them', () => { const nodes=[{ref:{id:'A',revision:1},dependencies:[{id:'B',revision:1}],state:'x'},{ref:{id:'B',revision:1},dependencies:[{id:'A',revision:1}],state:'x'}]; expect(()=>findAffected(nodes,{id:'A',revision:2})).toThrow('循环'); });
  it('rejects dangling event and review references on import', () => { const p = recordMeaningReview(fixture(), 'F001', c); p.meaningReviews[0]!.sourceRefs[0]!.revision=900; expect(()=>previewImport(JSON.stringify(p))).toThrow('找不到'); });
});

describe('LP02 AC17 transactional storage and import', () => {
  it('checks real File bytes before reading and accepts the downloaded JSON structure', async () => {
    const file = new File([serializeProject(fixture())], 'backup.json', { type: 'application/json' });
    expect(await readImportFile(file)).toEqual(fixture());
    await expect(readImportFile(new File(['中'.repeat(800000)], 'large.json'))).rejects.toThrow('2MiB');
  });
  it('unknown values remain ineligible even with a synthetically supplied personal review', () => {
    const p = fixture(); const next = saveEntity(p, 'facts', { ...first(p), value: null, missingReason: '未取得' }, 1, c);
    const reviewed = recordMeaningReview(next, 'F001', { ...c, author: 'self' });
    expect(assessEvidence(first(reviewed), reviewed).eligibleForClaim).toBe(false);
  });
  it('saves and reloads a byte-validated project and retains a previous valid backup', async () => { const {store} = storageFixture(); const p=fixture(); const token=await store.save(p,null); const next=editMission(p,{...p.mission,question:'合成测试任务'},1,c); await store.save(next,token); expect(store.load().project).toEqual(next); expect(store.readBackup()).toEqual(p); });
  it('JSON roundtrip preserves all versions and changes', () => { const p=fixture(); const next=saveEntity(p,'facts',{...first(p),conditions:['合成自动测试']},1,c); expect(previewImport(serializeProject(next))).toEqual(next); });
  it.each(['{','null','{"schemaVersion":"99.0.0"}'])('invalid import %s leaves valid storage untouched', async json => { const {store,memory}=storageFixture(); await store.save(fixture(),null); const before=new Map(memory.data); expect(()=>previewImport(json)).toThrow(); expect(memory.data).toEqual(before); });
  it('backup write failure never changes main', async () => { const {store,memory}=storageFixture(); const p=fixture(); const token=await store.save(p,null); memory.failKey=store.backup; await expect(store.save(p,token)).rejects.toThrow('Quota'); expect(memory.getItem(store.main)).toBe(token); });
  it('main write failure preserves old main and a usable backup', async () => { const {store,memory}=storageFixture(); const p=fixture(); const token=await store.save(p,null); memory.failKey=store.main; await expect(store.save(p,token)).rejects.toThrow('Quota'); expect(memory.getItem(store.main)).toBe(token); expect(store.readBackup()).toEqual(p); });
  it('blocked storage still permits in-memory JSON serialization', () => { const {store,memory}=storageFixture(); memory.denyRead=true; expect(store.load().status).toBe('unavailable'); expect(previewImport(serializeProject(fixture())).facts).toHaveLength(8); });
  it('two stale writers cannot silently overwrite each other under the same lock', async () => { const {store}=storageFixture(); const p=fixture(); const token=await store.save(p,null); const a=editMission(p,{...p.mission,question:'A'},1,c); const b=editMission(p,{...p.mission,question:'B'},1,c); const results=await Promise.allSettled([store.save(a,token),store.save(b,token)]); expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']); expect(store.load().project!.mission.question).toBe('A'); });
  it('detects another tab clearing storage even at the same project revision', async () => { const {store,memory}=storageFixture(); const p=fixture(); const token=await store.save(p,null); memory.data.delete(store.main); await expect(store.save(p,token)).rejects.toBeInstanceOf(ConflictError); });
  it('does not auto overwrite damaged stored JSON; explicit recovery preserves raw original', async () => { const {store,memory}=storageFixture(); memory.setItem(store.main,'broken'); expect(store.load().status).toBe('invalid'); await expect(store.save(fixture(),'broken')).rejects.toThrow('损坏'); expect(memory.getItem(store.main)).toBe('broken'); await store.save(fixture(),'broken',fixture(),true); expect(memory.getItem(store.recovery)).toBe('broken'); expect(store.load().status).toBe('valid'); });
  it('replacement preserves unsaved memory as backup and rebases project revision', async () => { const {store}=storageFixture(); const p=fixture(); const token=await store.save(p,null); const dirty=editMission(p,{...p.mission,question:'尚未保存的工作'},1,c); const replacement=replaceProject(dirty,fixture()); await store.save(replacement,token,dirty,true); expect(store.readBackup()).toEqual(dirty); expect(store.load().project!.projectRevision).toBeGreaterThan(dirty.projectRevision); });
  it('imported personal attestations retained as history, never blindly trusted', () => { const p=personalFixture(fixture()); const imported=replaceProject(p,previewImport(serializeProject(p))); expect(imported.meaningReviews[0]!.authorType).toBe('self'); expect(imported.meaningReviews[0]!.imported).toBe(true); expect(assessEvidence(first(imported),imported).eligibleForClaim).toBe(false); });
  it('rejects dangling product references in retained mission history as well as current mission', () => {
    const p = fixture(); const next = editMission(p, { ...p.mission, question: '历史引用校验' }, 1, c);
    next.missionHistory[0]!.focalProductRef.id = 'MISSING-PRODUCT';
    expect(() => previewImport(JSON.stringify(next))).toThrow('找不到');
  });
  it('uses revision order rather than JSON array order to validate legacy fact snapshots', () => {
    const p = fixture(); const second = editMission(p, { ...p.mission, asOfDate: '2020-01-01' }, 1, c);
    const third = editMission(second, { ...second.mission, question: '历史数组顺序测试' }, 2, c);
    third.missionHistory.reverse();
    expect(previewImport(JSON.stringify(third)).missionHistory).toHaveLength(2);
  });
  it('keeps a valid near-limit backup exportable when indentation alone would exceed 2MiB', () => {
    const p = fixture(); const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
    for (let i = 0; i < 180 && bytes(JSON.stringify(p, null, 2)) <= 2 * 1024 * 1024; i++) {
      p.sources.push({ ...p.sources[0]!, id: `S-SIZE-${i}`, summary: 'a'.repeat(5000), limitation: 'b'.repeat(5000), locator: 'c'.repeat(5000) });
    }
    expect(bytes(JSON.stringify(p, null, 2))).toBeGreaterThan(2 * 1024 * 1024);
    expect(bytes(JSON.stringify(p))).toBeLessThanOrEqual(2 * 1024 * 1024);
    const json = serializeProject(p);
    expect(previewImport(json)).toEqual(p);
  });
});
