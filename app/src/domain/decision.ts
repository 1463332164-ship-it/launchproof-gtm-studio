import type { Decision, Project, Ref, VersionedEntity } from './entities';
import { asRef, currentEntity, pinnedEntity, refKey } from './refs';
import { dependencyClosure, entityDependencies } from './provenance';
import { messageFingerprint, reviewMessage, RULES_VERSION, sha256 } from './messageReview';

export function newDecision(p:Project, refs:Ref[], now:string):Decision {
  return {id:'D-'+crypto.randomUUID().slice(0,8),revision:1,createdAt:now,updatedAt:now,createdBy:'ai_assisted',archived:false,
    missionRef:asRef(p.mission),question:p.mission.question,options:refs.map((r,i)=>({id:'O'+(i+1),summary:r.id+' 信息方向（待作者说明）',kind:'message',messageRefs:[r],scenarioRefs:[]})),
    selectedOptionId:null,purpose:'research_only',rationale:'',tradeoffs:[],supportingRefs:[],counterRefs:[],counterSearchNote:'',unresolvedGaps:[],revisitTriggers:[],owner:'',decidedAt:null,nextSteps:[],
    state:'draft',inputFingerprint:null,rulesVersion:RULES_VERSION,previousDecisionRef:null,changeReason:null,personalReview:null,english:{}};
}
export function rebindDecision(p:Project,d:Decision):Decision {
  const bind=(r:Ref)=>asRef(currentEntity(p,r)??r);
  return {...d,missionRef:asRef(p.mission),options:d.options.map(o=>({...o,messageRefs:o.messageRefs.map(bind)})),supportingRefs:d.supportingRefs.map(bind),counterRefs:d.counterRefs.map(bind)};
}
/** Exact historical closure for export. Never silently replace a pinned revision. */
export function pinnedClosure(p:Project,d:Decision) {
  const mission=pinnedEntity(p,d.missionRef);
  if(!mission||!('focalProductRef' in mission)) throw new Error('决定任务引用缺失');
  const context={...p,mission}; const nodes:VersionedEntity[]=[]; const done=new Set<string>(),active=new Set<string>();
  function visit(ref:Ref) {
    const key=refKey(ref);if(active.has(key))throw new Error('导出依赖循环：'+key);if(done.has(key))return;
    const e=pinnedEntity(p,ref);if(!e)throw new Error('导出引用缺失：'+key);
    active.add(key);nodes.push(e);
    const deps='focalProductRef' in e?[e.focalProductRef,...e.competitorRefs]:'modelName' in e?e.sourceRefs:entityDependencies(e,context);
    deps.forEach(visit);active.delete(key);done.add(key);
  }
  visit(asRef(d));return nodes.sort((a,b)=>refKey(a).localeCompare(refKey(b),'en'));
}
export async function decisionFingerprint(p:Project,d:Decision) {
  const {revision:_r,createdAt:_ca,updatedAt:_ua,createdBy:_by,state:_s,inputFingerprint:_f,personalReview:_pr,previousDecisionRef:_pv,changeReason:_cr,decidedAt:_da,...content}=d;
  const closure=dependencyClosure(p,entityDependencies(d,p));
  const messages=closure.nodes.filter(e=>'claimItems' in e);
  return sha256({rulesVersion:RULES_VERSION,content,closure:closure.nodes,issues:closure.issues,
    messageInputs:await Promise.all(messages.map(async m=>({ref:asRef(m),fingerprint:await messageFingerprint(p,m)})))});
}
export async function assessDecision(p:Project,d:Decision) {
  const errors:string[]=[],warnings:string[]=[];
  if(d.options.length<2)errors.push('至少需要两个候选');
  const selected=d.options.find(o=>o.id===d.selectedOptionId);
  if(!selected)errors.push('请选择一个候选或明确暂缓');
  if(!d.rationale.trim())errors.push('填写选择理由');
  if(!d.tradeoffs.length)errors.push('填写未选方案与取舍');
  if(!d.counterRefs.length&&!d.counterSearchNote.trim())errors.push('填写反证引用或寻找反证的说明');
  if(!d.revisitTriggers.length)errors.push('至少填写一个重新核查触发条件');
  if(!d.owner.trim()||!d.nextSteps.length)errors.push('填写责任归属和下一步验证任务');
  const closure=dependencyClosure(p,entityDependencies(d,p));warnings.push(...closure.issues);
  const stored=currentEntity(p,d);const historical=!!stored&&stored.revision>d.revision;
  if(historical)warnings.push('当前选择为历史决定版本，不能作当前已复核导出');
  if(selected?.kind==='message'&&!selected.messageRefs.length)errors.push('信息候选至少绑定一个Message');
  for(const r of selected?.messageRefs??[]) {
    const m=pinnedEntity(p,r);if(!m||!('claimItems' in m)){errors.push('候选消息引用缺失');continue;}
    const result=await reviewMessage(p,m);
    if(result.blockingIssues.length)errors.push(r.id+'尚有阻断项，只能保留为未采用材料或选择暂缓：'+result.blockingIssues.join('；'));
    if(d.purpose==='external_message'&&(m.reviewState!=='ready_with_limits'||result.state!=='ready_with_limits'))errors.push(r.id+'尚未完成本人信息审核');
    if(d.purpose==='research_only'&&result.state!=='ready_with_limits')warnings.push(r.id+'仅为待复核研究材料，不代表可发布广告');
  }
  if(d.purpose==='external_message'&&closure.issues.length)errors.push('对外方案引用必须为当前有效版本');
  if(d.purpose==='external_message'&&(!d.personalReview||d.personalReview.imported))errors.push('本人尚未确认该决定');
  if(d.purpose==='research_only'&&!d.unresolvedGaps.length)errors.push('研究倾向必须披露未验证假设与资料缺口');
  if(closure.nodes.some(e=>'researchStatus' in e))warnings.push('用户假设未经验证，评分不证明需求或商业效果');
  const fingerprint=await decisionFingerprint(p,d);
  const changed=!!d.inputFingerprint&&d.inputFingerprint!==fingerprint;
  return {errors:[...new Set(errors)],warnings:[...new Set(warnings)],fingerprint,changed,
    needsReview:historical||changed||closure.issues.length>0||d.state==='needs_review'};
}
