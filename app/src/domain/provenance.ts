import type { Project, Ref, VersionedEntity } from './entities';
import { latest, refKey, allEntities, currentEntity } from './refs';

export interface DependencyNode { ref: Ref; dependencies: Ref[]; state: string }

/** Same logical ID changes invalidate current dependants even when they pin an older revision. */
export function findAffected(nodes: DependencyNode[], changed: Ref): Ref[] {
  const keys = new Set<string>();
  for (const n of nodes) {
    if (keys.has(refKey(n.ref))) throw new Error('依赖节点重复');
    keys.add(refKey(n.ref));
  }
  const visited = new Set<string>(); const visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error('依赖循环，停止传播');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const n of nodes.filter(n => n.ref.id === id)) for (const dep of n.dependencies) visit(dep.id);
    visiting.delete(id); visited.add(id);
  }
  nodes.forEach(n => visit(n.ref.id));
  const affected = new Set([changed.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (!affected.has(n.ref.id) && n.dependencies.some(d => affected.has(d.id))) {
      affected.add(n.ref.id); grew = true;
    }
  }
  return nodes.filter(n => n.ref.id !== changed.id && affected.has(n.ref.id)).map(n => n.ref);
}

/** Integration seam for future Message/Decision modules; it does not implement those modules. */
export function invalidateDependants(nodes: DependencyNode[], changed: Ref): DependencyNode[] {
  const affected = new Set(findAffected(nodes, changed).map(refKey));
  return nodes.map(n => affected.has(refKey(n.ref)) ? { ...n, state: 'needs_review' } : { ...n });
}

export function evidenceGraph(p: Project): DependencyNode[] {
  return latest(allEntities(p)).map(e => ({ref:{id:e.id,revision:e.revision},state:'reviewState' in e ? e.reviewState : 'recorded',dependencies:entityDependencies(e,p)}));
}

export function entityDependencies(e: VersionedEntity, p: Project): Ref[] {
  if ('options' in e) return [e.missionRef,...e.options.flatMap(o=>o.messageRefs),...e.supportingRefs,...e.counterRefs];
  if ('evidenceLinks' in e) return [p.mission,e.subjectRef,...e.evidenceLinks.map(l=>l.sourceRef),
    ...(typeof e.value==='object' && e.value && 'sourceRefs' in e.value ? e.value.sourceRefs : [])];
  if ('claimItems' in e) return [e.missionRef,e.segmentHypothesisRef,...e.barrierRefs,...e.claimItems.flatMap(c=>[...c.basisRefs,...(c.comparisonScope?.productRefs??[])])];
  if ('hypothesisRef' in e) return [e.hypothesisRef];
  if ('basisRefs' in e) return e.basisRefs;
  if ('premiseRefs' in e) return [...e.premiseRefs,...e.counterEvidenceRefs];
  return [];
}
export function dependencyClosure(p: Project, refs: Ref[]) {
  const nodes: VersionedEntity[]=[]; const visited=new Set<string>(); const visiting=new Set<string>(); const issues:string[]=[];
  function visit(r:Ref) {
    if(visiting.has(r.id)) throw new Error('依赖循环');
    const e=currentEntity(p,r);
    if(!e) { issues.push('引用缺失：'+refKey(r)); return; }
    if(e.revision!==r.revision) issues.push('上游已更新：'+refKey(r)+' → '+refKey(e));
    if(e.archived) issues.push('引用已归档：'+refKey(e));
    if(visited.has(e.id)) return;
    visiting.add(e.id); nodes.push(e);
    entityDependencies(e,p).forEach(visit);
    visiting.delete(e.id); visited.add(e.id);
  }
  refs.forEach(visit); return { nodes, issues:[...new Set(issues)] };
}

export function referencedBy(p: Project, id: string): string[] {
  // Retained history is also a reference. Physical deletion is never offered.
  const names = new Set<string>();
  for (const f of p.facts) if (f.evidenceLinks.some(l => l.sourceRef.id === id) ||
    (typeof f.value === 'object' && f.value !== null && 'sourceRefs' in f.value && f.value.sourceRefs.some(r => r.id === id))) names.add(`${f.id}@${f.revision}`);
  for (const product of p.products) if (product.sourceRefs.some(r => r.id === id)) names.add(product.id);
  for(const entity of [...p.hypotheses,...p.insights,...p.barriers,...p.messages,...p.decisions]) if(entityDependencies(entity,p).some(r=>r.id===id)) names.add(refKey(entity));
  return [...names];
}
