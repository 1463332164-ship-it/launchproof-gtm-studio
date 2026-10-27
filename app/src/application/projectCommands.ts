import type { Author, Fact, Project, Ref, Source } from '../domain/entities';
import { factSchema, missionSchema, sourceSchema } from '../domain/schema';
import { currentFacts, latest, refKey, validateProjectJson } from '../domain/validation';
import { evidenceGraph, findAffected, referencedBy } from '../domain/provenance';
import { assessEvidence } from '../domain/evidence';
import { allEntities, asRef, currentEntity } from '../domain/refs';
import { hypothesisSchema, barrierSchema, messageSchema, weightsSchema } from '../domain/schema';
import type { Hypothesis, Barrier, Message, Weights } from '../domain/entities';
import { reviewMessage } from '../domain/messageReview';
import { decisionSchema } from '../domain/schema';
import type { Decision } from '../domain/entities';
import { assessDecision } from '../domain/decision';
import { createResearchDrafts } from '../data/researchDrafts';

export interface CommandContext { now: string; reason: string; author: Author }
const ref = (e: Ref): Ref => ({ id: e.id, revision: e.revision });
function finish(p: Project): Project {
  p.schemaVersion = p.decisions.length || p.schemaVersion==='1.3.0' ? '1.3.0' : p.hypotheses.length || p.barriers.length || p.messages.length || p.insights.length || p.schemaVersion==='1.2.0' ? '1.2.0' : '1.1.0'; p.projectRevision++;
  const result = validateProjectJson(JSON.stringify(p));
  if (!result.ok) throw new Error(result.errors.map(e => `${e.path}: ${e.message}`).join('\n'));
  return result.data;
}
function context(c: CommandContext) {
  if (!c.reason.trim()) throw new Error('必须记录修改理由');
  if (!Number.isFinite(Date.parse(c.now))) throw new Error('修改时间无效');
}
function record(p: Project, before: Ref | null, after: Ref, fields: string[], c: CommandContext, affected: Ref[]) {
  context(c);
  p.changeEvents.push({ id: `CE-${p.projectRevision + 1}-${p.changeEvents.length + 1}`, entityRefBefore: before && ref(before), entityRefAfter: ref(after),
    changedFields: fields, reason: c.reason.trim(), authorType: c.author, occurredAt: c.now, affectedRefs: affected });
  for(const target of affected) {
    const message=latest(p.messages).find(m=>m.id===target.id);
    if(message) {
      const updated={...message,revision:message.revision+1,updatedAt:c.now,createdBy:c.author,reviewState:'needs_review' as const};
      p.messages.push(updated);
      p.changeEvents.push({id:'CE-'+(p.projectRevision+1)+'-'+(p.changeEvents.length+1),entityRefBefore:ref(message),entityRefAfter:ref(updated),changedFields:['reviewState'],reason:'上游'+after.id+'变化；保留旧快照，信息需复核。',authorType:c.author,occurredAt:c.now,affectedRefs:[]});
    }
    const decision=latest(p.decisions).find(d=>d.id===target.id);
    if(decision) {
      const updated:Decision={...decision,revision:decision.revision+1,updatedAt:c.now,createdBy:c.author,state:'needs_review',previousDecisionRef:ref(decision),changeReason:'上游'+after.id+'变化，待复核'};
      p.decisions.push(updated);
      p.changeEvents.push({id:'CE-'+(p.projectRevision+1)+'-'+(p.changeEvents.length+1),entityRefBefore:ref(decision),entityRefAfter:ref(updated),changedFields:['state'],reason:updated.changeReason!,authorType:c.author,occurredAt:c.now,affectedRefs:[]});
    }
    const insight=latest(p.insights).find(i=>i.id===target.id);
    if(insight) p.insights.push({...insight,revision:insight.revision+1,updatedAt:c.now,createdBy:c.author,reviewState:'needs_review'});
  }
}
export function editMission(p: Project, input: unknown, expectedRevision: number, c: CommandContext): Project {
  const draft = missionSchema.parse(input);
  if (p.mission.revision !== expectedRevision || draft.id !== p.mission.id) throw new Error('任务版本已变化，请重新打开编辑');
  const operatorDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(c.now));
  if (draft.asOfDate > operatorDay) throw new Error('评估日期不能晚于本次操作日；未来情景属于后续版本');
  const next = structuredClone(p);
  next.missionHistory.push(structuredClone(p.mission));
  next.mission = { ...draft, revision: expectedRevision + 1, createdAt: p.mission.createdAt, updatedAt: c.now, createdBy: c.author };
  record(next, p.mission, next.mission, ['mission'], c, findAffected(evidenceGraph(p), p.mission));
  return finish(next);
}
export function saveEntity(p: Project, kind: 'facts' | 'sources', input: unknown, expectedRevision: number | null, c: CommandContext): Project {
  context(c);
  const draft = kind === 'facts' ? factSchema.parse(input) : sourceSchema.parse(input);
  const existing = latest(p[kind] as (Fact | Source)[]).find(e => e.id === draft.id);
  if (expectedRevision === null && (existing || [p.mission, ...p.products, ...p.facts, ...p.sources].some(e => e.id === draft.id))) throw new Error('ID已存在；新增记录必须使用新ID');
  if (expectedRevision !== null && (!existing || existing.revision !== expectedRevision)) throw new Error('编辑版本已变化，请重新打开编辑');
  const next = structuredClone(p);
  const value = { ...draft, revision: (existing?.revision ?? 0) + 1, createdAt: existing?.createdAt ?? c.now, updatedAt: c.now, createdBy: c.author };
  if (kind === 'facts') {
    const f = value as Fact;
    f.supersedesRef = existing ? ref(existing) : null;
    f.assessmentDate = p.mission.asOfDate;
    const assessed = assessEvidence(f, p);
    f.supportStatus = assessed.supportStatus; f.freshness = assessed.freshness;
    if (f.supportStatus === 'contested' && !f.conflictGroupId) f.conflictGroupId = `CF-${f.id}`;
    next.facts.push(f);
  } else next.sources.push(value as Source);
  record(next, existing ?? null, value, [kind], c, findAffected(evidenceGraph(p), value));
  return finish(next);
}
export function archiveEntity(p: Project, kind: 'facts' | 'sources', id: string, c: CommandContext): Project {
  const item = latest(p[kind] as (Fact | Source)[]).find(e => e.id === id);
  if (!item) throw new Error('记录不存在');
  if (kind === 'sources' && !item.archived) {
    const refs = referencedBy(p, id);
    if (refs.length) throw new Error(`来源被引用，不能删除或归档：${refs.join('、')}。可记录失联状态，保留历史。`);
  }
  // Restore is another revision too. Never physically delete any history.
  return saveEntity(p, kind, { ...item, archived: !item.archived }, item.revision, c);
}
export function recordMeaningReview(p: Project, factId: string, c: CommandContext): Project {
  context(c);
  const fact = currentFacts(p).find(f => f.id === factId);
  if (!fact) throw new Error('找不到当前事实');
  if (fact.evidenceLinks.some(l => latest(p.sources).find(s => s.id === l.sourceRef.id)?.revision !== l.sourceRef.revision)) throw new Error('先核对并重新绑定来源的新版本，再记录语义核查');
  const next = structuredClone(p);
  next.meaningReviews.push({ factRef: ref(fact), missionRef: ref(p.mission), sourceRefs: fact.evidenceLinks.map(l => ref(l.sourceRef)),
    note: c.reason, occurredAt: c.now, authorType: c.author, imported: false });
  record(next, null, fact, ['meaningReview'], c, []);
  return finish(next);
}
export function replaceProject(current: Project, candidate: Project): Project {
  const next = structuredClone(candidate);
  // Retain imported attestations as history, but do not trust them as new personal checks.
  next.meaningReviews = next.meaningReviews.map(r => ({ ...r, imported: true }));
  next.messages = next.messages.map(m=>({...m,reviewState:m.reviewState==='draft'?'draft':'needs_review',humanReview:m.humanReview?{...m.humanReview,imported:true}:null}));
  next.decisions = next.decisions.map(d=>({...d,state:d.state==='recorded'?'needs_review':d.state,personalReview:d.personalReview?{...d.personalReview,imported:true}:null}));
  next.insights = next.insights.map(i=>({...i,reviewState:i.reviewState==='reviewed'?'needs_review':i.reviewState}));
  next.projectRevision = Math.max(current.projectRevision, next.projectRevision);
  return finish(next);
}
export function reviewSummary(p: Project) {
  return currentFacts(p).map(f => ({ ref: refKey(f), ...assessEvidence(f, p) }));
}

export type ResearchKind='hypotheses'|'barriers'|'messages';
export function saveResearch(p:Project,kind:ResearchKind,input:unknown,expectedRevision:number|null,c:CommandContext):Project {
  context(c);
  const draft=kind==='hypotheses'?hypothesisSchema.parse(input):kind==='barriers'?barrierSchema.parse(input):messageSchema.parse(input);
  const existing=latest(p[kind] as (Hypothesis|Barrier|Message)[]).find(x=>x.id===draft.id);
  if(expectedRevision===null && allEntities(p).some(x=>x.id===draft.id)) throw new Error('ID已存在');
  if(expectedRevision!==null && (!existing || existing.revision!==expectedRevision)) throw new Error('版本已变化，请重新打开编辑');
  const next=structuredClone(p);
  const value={...draft,revision:(existing?.revision??0)+1,createdAt:existing?.createdAt??c.now,updatedAt:c.now,createdBy:c.author};
  if(kind==='messages') {
    const m=value as Message;
    m.reviewState='draft'; m.inputFingerprint=null; m.humanReview=null;
    m.claimItems=m.claimItems.map(claim=>({...claim,humanMeaningReview:false}));
    next.messages.push(m);
  } else if(kind==='hypotheses') next.hypotheses.push(value as Hypothesis);
  else next.barriers.push(value as Barrier);
  record(next,existing??null,value,[kind],c,findAffected(evidenceGraph(p),value));
  return finish(next);
}
export function addResearchExamples(p:Project,c:CommandContext):Project {
  context(c);
  const additions=createResearchDrafts(p,c.now);
  const incoming=[...additions.hypotheses,...additions.barriers,...additions.messages];
  if(incoming.some(x=>allEntities(p).some(e=>e.id===x.id))) throw new Error('研究样例ID已经存在；不会覆盖已有内容');
  const next=structuredClone(p);
  next.hypotheses.push(...additions.hypotheses); next.barriers.push(...additions.barriers); next.messages.push(...additions.messages);
  for(const item of incoming) record(next,null,item,['research_example'],{...c,author:'ai_assisted',reason:'载入原规划的未验证研究样例；实际样本0，AI辅助草案。'},[]);
  return finish(next);
}
export function setResearchWeights(p:Project,weights:Weights,c:CommandContext):Project {
  const valid=weightsSchema.parse(weights); const barriers=latest(p.barriers).filter(b=>!b.archived);
  if(!barriers.length) throw new Error('尚无购买障碍');
  return barriers.reduce((next,b)=>saveResearch(next,'barriers',{...b,weights:valid},b.revision,c),p);
}
export function currentMessageRefs(p:Project,m:Message):Message {
  const bind=(r:Ref)=>asRef(currentEntity(p,r)??r);
  return {...m,missionRef:asRef(p.mission),segmentHypothesisRef:bind(m.segmentHypothesisRef),barrierRefs:m.barrierRefs.map(bind),
    claimItems:m.claimItems.map(c=>({...c,basisRefs:c.basisRefs.map(bind),comparisonScope:c.comparisonScope?{...c.comparisonScope,productRefs:c.comparisonScope.productRefs.map(bind)}:null}))};
}
export async function checkMessage(p:Project,id:string,expectedRevision:number,c:CommandContext,personalConfirmed:boolean):Promise<Project> {
  context(c); const original=latest(p.messages).find(m=>m.id===id);
  if(!original || original.revision!==expectedRevision) throw new Error('版本已变化，请重新打开审核');
  const next=structuredClone(p); const personal=c.author==='self' && personalConfirmed;
  const message:Message={...structuredClone(original),revision:original.revision+1,updatedAt:c.now,createdBy:c.author,
    reviewState:'draft',inputFingerprint:null,reviewerNote:c.reason,
    claimItems:original.claimItems.map(claim=>({...claim,humanMeaningReview:personal})),
    humanReview:{authorType:c.author,reviewedAt:c.now,bilingualConfirmed:personal,warningsConfirmed:personal,imported:false}};
  const assessment=await reviewMessage(p,message);
  message.reviewState=assessment.state; message.inputFingerprint=assessment.inputFingerprint;
  next.messages.push(message); record(next,original,message,['reviewState'],c,findAffected(evidenceGraph(p),message));
  return finish(next);
}

export async function saveDecision(p:Project,input:unknown,expectedRevision:number|null,c:CommandContext,recorded:boolean,personalConfirmed:boolean):Promise<Project> {
  context(c);const draft=decisionSchema.parse(input);const existing=latest(p.decisions).find(d=>d.id===draft.id);
  if(expectedRevision===null&&allEntities(p).some(e=>e.id===draft.id))throw new Error('ID已存在');
  if(expectedRevision!==null&&(!existing||existing.revision!==expectedRevision))throw new Error('决定版本已变化，请重新打开');
  const personal=c.author==='self'&&personalConfirmed;
  const d:Decision={...draft,revision:(existing?.revision??0)+1,createdAt:existing?.createdAt??c.now,updatedAt:c.now,createdBy:c.author,
    previousDecisionRef:existing?ref(existing):null,changeReason:c.reason,state:recorded?'recorded':'draft',decidedAt:recorded?c.now:null,inputFingerprint:null,
    personalReview:recorded&&personal?{authorType:'self',confirmedAt:c.now,note:c.reason,imported:false}:null};
  d.english=Object.fromEntries(Object.entries(d.english).map(([key,value])=>[key.startsWith(d.id+'@'+draft.revision+'.')?key.replace(d.id+'@'+draft.revision+'.',d.id+'@'+d.revision+'.'):key,value]));
  if(recorded){const result=await assessDecision(p,d);if(result.errors.length)throw new Error(result.errors.join('；'));d.inputFingerprint=result.fingerprint;}
  const next=structuredClone(p);next.decisions.push(d);record(next,existing??null,d,['decision'],c,[]);return finish(next);
}
