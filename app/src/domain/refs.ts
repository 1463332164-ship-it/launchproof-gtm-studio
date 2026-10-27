import type { Project, Ref, VersionedEntity } from './entities';
export const refKey = (ref: Ref): string => ref.id + '@' + ref.revision;
export const asRef = (ref: Ref): Ref => ({ id: ref.id, revision: ref.revision });
export function latest<T extends VersionedEntity>(items: T[]): T[] {
  const map = new Map<string,T>();
  for (const item of items) if (!map.has(item.id) || map.get(item.id)!.revision < item.revision) map.set(item.id,item);
  return [...map.values()];
}
export function allEntities(p: Project): VersionedEntity[] {
  return [...p.missionHistory,p.mission,...p.products,...p.sources,...p.facts,...p.hypotheses,...p.barriers,...p.insights,...p.messages,...p.decisions];
}
export const pinnedEntity = (p: Project, ref: Ref) => allEntities(p).find(x => refKey(x) === refKey(ref));
export const currentEntity = (p: Project, ref: Ref) => latest(allEntities(p)).find(x => x.id === ref.id);

