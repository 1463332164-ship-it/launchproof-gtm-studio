import type { Message, Project, Ref } from './entities';
import { assessEvidence } from './evidence';
import { dependencyClosure, entityDependencies } from './provenance';
import { pinnedEntity, refKey } from './refs';
import { buildComparison } from './comparison';
export const RULES_VERSION = '1.0.0';
export function canonicalize(value: unknown): string {
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) {
    const items = value.every(x=>x && typeof x==='object' && 'id' in x && 'revision' in x)
      ? [...value].sort((a,b)=>refKey(a).localeCompare(refKey(b),'en')) : value;
    return '['+items.map(canonicalize).join(',')+']';
  }
  const object=value as Record<string,unknown>;
  return '{'+Object.keys(object).sort().map(k=>JSON.stringify(k)+':'+canonicalize(object[k])).join(',')+'}';
}
export async function sha256(value: unknown): Promise<string> {
  const bytes=new TextEncoder().encode(canonicalize(value));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function messageFingerprint(p: Project,m: Message): Promise<string> {
  const deps=dependencyClosure(p,entityDependencies(m,p));
  const {inputFingerprint: _fp,humanReview:_hr,reviewState:_state,reviewerNote:_note,revision:_rev,createdAt:_ca,updatedAt:_ua,createdBy:_by,...content}=m;
  const factIds=deps.nodes.filter(n=>'evidenceLinks' in n).map(n=>n.id);
  return sha256({rulesVersion:RULES_VERSION, mission:p.mission, content:{...content,claimItems:content.claimItems.map(({humanMeaningReview:_human,...c})=>c)},
    nodes:deps.nodes, meaningReviews:p.meaningReviews.filter(r=>factIds.includes(r.factRef.id)), issues:deps.issues});
}
const numbers=(s:string)=>[...new Set(s.match(/\d+(?:\.\d+)?/g)??[])].sort().join('|');
export interface MessageAssessment {state:Message['reviewState']; blockingIssues:string[]; warnings:string[]; inputFingerprint:string; changed:boolean}
export async function reviewMessage(p: Project,m: Message):Promise<MessageAssessment> {
  const blockingIssues:string[]=[]; const warnings:string[]=[];
  const closure=dependencyClosure(p,entityDependencies(m,p));
  blockingIssues.push(...closure.issues);
  if(!m.headlineEn || !m.valuePropositionEn) blockingIssues.push('标题或价值主张缺英文');
  const allText=[m.headlineZh,m.headlineEn,m.valuePropositionZh,m.valuePropositionEn,...m.claimItems.flatMap(c=>[c.textZh,c.textEn])].join(' ');
  if(/所有|保证|无需任何Hub|无需额外设备|零风险|提升转化|必买|guarantee|all curtains|no (?:extra |additional )?(?:hub|devices)|zero risk|increase conversion/i.test(allText))
    warnings.push('存在过强或效果承诺用语；词表仅为提示，必须逐句人工审查');
  for(const c of m.claimItems) {
    const prefix=c.id+'：';
    if(!c.textEn || !c.qualifierZh || !c.qualifierEn) blockingIssues.push(prefix+'中英文表述和限定语都必须填写');
    if(c.textEn && numbers(c.textZh)!==numbers(c.textEn)) blockingIssues.push(prefix+'中英文主张数字不一致');
    if(c.qualifierEn && c.qualifierZh && numbers(c.qualifierZh)!==numbers(c.qualifierEn)) blockingIssues.push(prefix+'中英文限定语数字不一致');
    if(!c.basisRefs.length) blockingIssues.push(prefix+'缺少依据引用');
    for(const r of c.basisRefs) {
      const e=pinnedEntity(p,r);
      if(c.kind==='fact') {
        if(!e || !('evidenceLinks' in e)) {blockingIssues.push(prefix+'事实主张必须引用Fact');continue;}
        if(!assessEvidence(e,p).eligibleForClaim) blockingIssues.push(prefix+refKey(e)+'不是当前合格事实（含本人待核查）');
        if(!e.conditions.every(condition=>c.qualifierZh?.includes(condition))) blockingIssues.push(prefix+'中文限定语必须保留所引事实的全部适用条件');
      }
      if(c.kind==='hypothesis' && (!e || !('researchStatus' in e))) blockingIssues.push(prefix+'假设主张必须引用Hypothesis');
    }
    if(c.comparisonScope) {
      const row=buildComparison(p).find(d=>d.id===c.comparisonScope!.dimension)!;
      const scope=c.comparisonScope;
      const qualifiedSides=row.cells.every(cell=>scope.productRefs.some(r=>refKey(r)===refKey(cell.product)) &&
        !cell.missing && cell.facts.some(f=>c.basisRefs.some(r=>refKey(r)===refKey(f)) && assessEvidence(f,p).eligibleForClaim &&
          typeof f.value==='object' && f.value!==null && 'min' in f.value && ['mm','inch'].includes(f.value.unit)));
      if(row.id!=='diameter' || !qualifiedSides) blockingIssues.push(prefix+'缺少两侧同条件可比事实，不能审核对比优越性');
    }
    if(c.kind!=='fact') warnings.push(prefix+(c.kind==='inference'?'分析推断':'未验证假设')+'，不是用户研究发现或官方原话');
  }
  const inputFingerprint=await messageFingerprint(p,m);
  const changed=!!m.inputFingerprint && m.inputFingerprint!==inputFingerprint;
  const attested=m.humanReview?.authorType==='self' && !m.humanReview.imported && m.humanReview.bilingualConfirmed && m.claimItems.every(c=>c.humanMeaningReview) && !!m.reviewerNote.trim();
  if(warnings.length && !m.humanReview?.warningsConfirmed) warnings.push('仍需本人确认警示与主张强度');
  let state:Message['reviewState']=blockingIssues.length?'blocked':attested && (!warnings.length || m.humanReview?.warningsConfirmed)?'ready_with_limits':'needs_review';
  if(changed || m.reviewState==='needs_review' && closure.issues.length) state='needs_review';
  return {state,blockingIssues:[...new Set(blockingIssues)],warnings:[...new Set(warnings)],inputFingerprint,changed};
}
export const refsFromText = (text:string):Ref[] => text.split(/[\s,，]+/).filter(Boolean).map(token=>{
  const match=/^([A-Za-z0-9][A-Za-z0-9._-]{0,99})@(\d+)$/.exec(token);
  if(!match) throw new Error('引用格式应为F001@1，以逗号或换行分隔');
  return {id:match[1]!,revision:Number(match[2])};
});

