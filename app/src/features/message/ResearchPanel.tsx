import { useEffect, useState } from 'react';
import type { Author, Fact, Hypothesis, Message, Project } from '../../domain/entities';
import { latest, refKey, asRef } from '../../domain/refs';
import { dependencyClosure } from '../../domain/provenance';
import { reviewMessage } from '../../domain/messageReview';
import type { MessageAssessment } from '../../domain/messageReview';
import { EditorDialog } from '../../components/EditorDialog';
import { HypothesisEditor } from './HypothesisEditor';
import { BarrierEditor, PriorityPanel } from './PriorityPanel';
import { MessageEditor } from './MessageEditor';
import { DEFAULT_WEIGHTS } from '../../domain/priority';
import { addResearchExamples, checkMessage, saveResearch, setResearchWeights } from '../../application/projectCommands';
type Props={project:Project;author:Author;locked:boolean;onCommit:(p:Project)=>Promise<boolean>;onFact:(f:Fact)=>void;view:'research'|'messages';externalHypothesis:Hypothesis|null;closeExternal:()=>void;onCandidate:(m:Message)=>void;onMessages:()=>void};
export function ResearchPanel({project:p,author,locked,onCommit,onFact,view,externalHypothesis,closeExternal,onCandidate,onMessages}:Props) {
  const [hyp,setHyp]=useState<Hypothesis|null>(null);const [barrierId,setBarrierId]=useState<string|null>(null);const [messageId,setMessageId]=useState<string|null>(null);const [reviewId,setReviewId]=useState<string|null>(null);const [error,setError]=useState('');
  const ctx=(reason:string)=>({now:new Date().toISOString(),reason,author});
  const hypotheses=latest(p.hypotheses).filter(h=>!h.archived),barriers=latest(p.barriers).filter(b=>!b.archived),messages=latest(p.messages).filter(m=>!m.archived);
  const selectedHyp=externalHypothesis??hyp;
  const commit=async(next:Project)=>{if(!await onCommit(next))throw new Error('保存暂停，请查看工作区冲突提示；表单仍保留。');};
  const selectedBarrier=barriers.find(b=>b.id===barrierId), selectedMessage=messages.find(m=>m.id===messageId),review=messages.find(m=>m.id===reviewId);
  return <section aria-label={view==='research'?'用户假设与障碍':'信息方案'}>
    <div className="section-heading"><div><div className="eyebrow">RESEARCH BEFORE PROMISES</div><h2>{view==='research'?'把购买障碍，写成可证伪的问题':'两套信息方向，逐条检查能说什么'}</h2></div></div>
    <p className="warning">假设 ≠ 用户发现；分析 ≠ 官方事实；信息草案 ≠ 已批准方案。实际样本0，无投放或转化效果证据。可以将信息加入候选并记录研究选择，仍不证明实际商业效果。</p>
    {!hypotheses.some(h=>['H001','H002','H003'].includes(h.id))&&!messages.length&&<div className="empty"><p>现有事实保持不变。可添加原规划中的3条未验证假设、3个未评分障碍和2套中英文草案。</p><button className="primary" disabled={locked} onClick={async()=>{try{await commit(addResearchExamples(p,ctx('载入LP03研究样例')));}catch(e){setError(String(e));}}}>载入3条假设与2套信息草案</button></div>}
    {error&&<p role="alert" className="error">{error}</p>}
    {view==='research'&&<><div className="hypothesis-grid">{hypotheses.map(h=><article className="research-card" key={h.id}><span className="badge amber">假设 · {h.researchStatus} · 实际样本 {h.actualSampleSize}</span><h3>{h.id} · {h.statement}</h3><p>{h.segment} / {h.context}</p><p><strong>反证条件：</strong>{h.falsificationCriterion}</p><p>{h.basisNote}</p><p className="muted">拟议样本 {h.validationPlan.plannedSampleSize}（设计假设，未招募）</p><p>依据：{h.basisRefs.map(refKey).join('、')||'暂无；按设计假设研究'}</p>
      {dependencyClosure(p,h.basisRefs).issues.map(issue=><p className="warning" key={issue}>{issue}；假设依据待复核，不改变研究状态。</p>)}
      <button disabled={locked} onClick={()=>setHyp(h)}>编辑假设 {h.id}</button><button onClick={onMessages}>前往信息方案 · {h.id}</button>
      {barriers.filter(b=>b.hypothesisRef.id===h.id).map(b=><div className="barrier-summary" key={b.id}><p>{b.id} · {b.label} · {b.evidenceNote}</p><button disabled={locked} onClick={()=>setBarrierId(b.id)}>编辑评分 {b.id}</button></div>)}
    </article>)}</div>
      <PriorityPanel key={barriers.map(b=>refKey(b)).join('|')} barriers={barriers} locked={locked} onWeights={async(weights,reason)=>commit(setResearchWeights(p,weights,ctx(reason)))}/>
    </>}
    {view==='messages'&&<div className="message-grid">{messages.map(m=><MessageCard key={refKey(m)} message={m} project={p} onFact={onFact} onEdit={()=>setMessageId(m.id)} onReview={()=>setReviewId(m.id)} onCandidate={()=>onCandidate(m)} locked={locked}/>)}</div>}
    {selectedHyp&&<HypothesisEditor item={selectedHyp} project={p} onClose={()=>{setHyp(null);closeExternal();}} onSave={async(h,reason)=>{const exists=latest(p.hypotheses).find(x=>x.id===h.id);let next=saveResearch(p,'hypotheses',h,exists?.revision??null,ctx(reason));if(!exists){const saved=latest(next.hypotheses).find(x=>x.id===h.id)!;const now=new Date().toISOString();next=saveResearch(next,'barriers',{id:'B-'+crypto.randomUUID().slice(0,8),revision:1,createdAt:now,updatedAt:now,createdBy:author,archived:false,hypothesisRef:asRef(saved),label:saved.context,impact:null,relevance:null,actionability:null,scoreRationale:{impact:'',relevance:'',actionability:''},weights:latest(p.barriers)[0]?.weights??DEFAULT_WEIGHTS,evidenceNote:'由比较问题提出的未验证假设；实际样本0。'},null,ctx('为新假设建立未评分障碍：'+reason));}await commit(next);setHyp(null);closeExternal();}}/>}
    {selectedBarrier&&<BarrierEditor item={selectedBarrier} hypotheses={hypotheses} onClose={()=>setBarrierId(null)} onSave={async(b,reason)=>{await commit(saveResearch(p,'barriers',b,selectedBarrier.revision,ctx(reason)));setBarrierId(null);}}/>}
    {selectedMessage&&<MessageEditor item={selectedMessage} project={p} onClose={()=>setMessageId(null)} onSave={async(m,reason)=>{await commit(saveResearch(p,'messages',m,selectedMessage.revision,ctx(reason)));setMessageId(null);}}/>}
    {review&&<MessageReviewDialog author={author} message={review} onClose={()=>setReviewId(null)} onConfirm={async(reason,personal)=>{await commit(await checkMessage(p,review.id,review.revision,ctx(reason),personal));setReviewId(null);}}/>}
  </section>;
}
const stateLabels={draft:'草案 / 未审核',blocked:'阻止审核通过',needs_review:'待复核',ready_with_limits:'作者复核通过（有限定，非发布批准）'};
function MessageCard({message:m,project:p,onFact,onEdit,onReview,onCandidate,locked}:{message:Message;project:Project;onFact:(f:Fact)=>void;onEdit:()=>void;onReview:()=>void;onCandidate:()=>void;locked:boolean}) {
  const [assessment,setAssessment]=useState<MessageAssessment|null>(null);const [error,setError]=useState('');
  useEffect(()=>{let active=true;void reviewMessage(p,m).then(result=>{if(active)setAssessment(result);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[p,m]);
  const effective=assessment?.changed?'needs_review':m.reviewState==='draft'?'draft':assessment?.state??'needs_review';
  return <article className="message-card"><div className="eyebrow">{m.id} · v{m.revision} · AI辅助起稿</div><span className={'badge '+(effective==='ready_with_limits'?'':'amber')}>{stateLabels[effective]}</span><h3>{m.headlineZh}</h3><p className="english">{m.headlineEn||'英文缺失'}</p><p>{m.valuePropositionZh}</p><p className="english">{m.valuePropositionEn||'英文缺失'}</p>
    <p className="muted">目标假设 {refKey(m.segmentHypothesisRef)} · 障碍 {m.barrierRefs.map(refKey).join('、')||'暂无'}</p>
    {m.claimItems.map(c=><section className="claim-card" key={c.id}><strong>{c.kind==='fact'?'事实主张':c.kind==='inference'?'分析推断':'未验证假设'} · {c.id}</strong><p>{c.textZh}</p><p className="english">{c.textEn||'英文缺失'}</p><p className="limit-box">{c.qualifierZh||'中文限定语缺失'}<br/>{c.qualifierEn||'英文限定语缺失'}</p><div className="toolbar">{c.basisRefs.map(r=>{const f=p.facts.find(f=>refKey(f)===refKey(r));return f?<button key={refKey(r)} onClick={()=>onFact(f)}>查看依据 {refKey(r)}</button>:<span key={refKey(r)}>{refKey(r)}</span>;})}</div></section>)}
    <p>下一步：{m.callToAction}</p>{error&&<p role="alert" className="error">{error}</p>}
    {assessment&&<div className="review-state"><strong>审核检查（结构规则不代替语义核对）</strong>{assessment.blockingIssues.length>0&&<ul>{assessment.blockingIssues.map(x=><li key={x}>{x}</li>)}</ul>}<ul>{assessment.warnings.map(x=><li key={x}>{x}</li>)}</ul>{!assessment.blockingIssues.length&&<p>结构检查没有阻断项；仍需本人逐句核对含义和中英文限定语。</p>}</div>}
    <div className="toolbar"><button disabled={locked} onClick={onEdit}>编辑方案 {m.id}</button><button disabled={locked||!assessment} onClick={onReview}>审核方案 {m.id}</button><button disabled={locked} onClick={onCandidate}>采用为候选 {m.id}</button></div><details><summary>此方案保留的版本</summary>{p.messages.filter(x=>x.id===m.id).map(x=><p key={refKey(x)}>{refKey(x)} · {stateLabels[x.reviewState]} · {x.reviewerNote||'尚无审核记录'}</p>)}</details>
  </article>;
}
function MessageReviewDialog({author,message,onClose,onConfirm}:{author:Author;message:Message;onClose:()=>void;onConfirm:(reason:string,personal:boolean)=>Promise<void>}) {
  const [note,setNote]=useState('');const [personal,setPersonal]=useState(false);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  return <EditorDialog title={'审核 '+message.id} onClose={onClose} dirty={!!note||personal}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onConfirm(note,personal);}catch(e){setError(String(e));}finally{setBusy(false);}}}><p>自动检查可以给出阻断项；只有实际本人操作与完整语义核查才可能通过。不会因此将LP01/LP02个人动作标为完成。</p><p>归属：{author==='self'?'本人亲自操作':'AI辅助操作（不能代替本人确认）'}</p><label>审核说明<textarea required value={note} onChange={e=>setNote(e.target.value)}/></label><label className="checkline"><input type="checkbox" disabled={author!=='self'} checked={personal} onChange={e=>setPersonal(e.target.checked)}/>本人已逐条核对依据、主张强度、警示与中英文限定语</label>{error&&<p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy}>执行审核并保存结果</button></form></EditorDialog>;
}

