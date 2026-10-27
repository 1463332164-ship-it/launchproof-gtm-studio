import { useEffect, useState } from 'react';
import type { Author, Decision, Fact, Project, Ref } from '../../domain/entities';
import { asRef, latest, refKey } from '../../domain/refs';
import { assessDecision, newDecision, pinnedClosure } from '../../domain/decision';
import { saveDecision } from '../../application/projectCommands';
import { DecisionEditor } from './DecisionEditor';
type Props={project:Project;author:Author;locked:boolean;externalDraft:Decision|null;clearDraft:()=>void;onCommit:(p:Project)=>Promise<boolean>;onFact:(f:Fact)=>void;onBrief:(r:Ref)=>void;onMessages:()=>void};
export function LedgerPanel({project:p,author,locked,externalDraft,clearDraft,onCommit,onFact,onBrief,onMessages}:Props){
  const [editing,setEditing]=useState<Decision|null>(null);const active=externalDraft??editing;
  return <section aria-label="决策记录"><div className="section-heading"><div><div className="eyebrow">EXPLAIN THE CHOICE</div><h2>记录为什么选，以及何时改选</h2></div><button disabled={locked} onClick={()=>setEditing(newDecision(p,latest(p.messages).filter(m=>!m.archived).map(asRef),new Date().toISOString()))}>新建决策草稿</button></div>
    <p className="warning">这里记录研究判断，不证明营销效果。AI辅助建议与本人确认分开；已有材料不足时，可以选择暂缓并安排验证。</p>
    {!p.decisions.length&&<p className="empty">尚无决定。先从信息方案加入候选，再填写自己的取舍；不会自动替你选A或B。<button onClick={onMessages}>前往信息方案</button></p>}
    {latest(p.decisions).map(d=><DecisionCard key={refKey(d)} project={p} decision={d} onFact={onFact} onEdit={()=>setEditing(d)} onBrief={onBrief} locked={locked}/>)}
    {active&&<DecisionEditor key={refKey(active)} item={active} project={p} author={author} onClose={()=>{setEditing(null);clearDraft();}} onSave={async(d,reason,recorded,personal)=>{
      const exists=latest(p.decisions).find(x=>x.id===d.id);
      const next=await saveDecision(p,d,exists?active.revision:null,{now:new Date().toISOString(),reason,author},recorded,personal);
      if(!await onCommit(next))throw new Error('保存冲突，表单保留；请先处理工作区提示');
      setEditing(null);clearDraft();
    }}/>}
  </section>;
}
function DecisionCard({project:p,decision:d,onFact,onEdit,onBrief,locked}:{project:Project;decision:Decision;onFact:(f:Fact)=>void;onEdit:()=>void;onBrief:(r:Ref)=>void;locked:boolean}){
  const [result,setResult]=useState<Awaited<ReturnType<typeof assessDecision>>|null>(null);const [error,setError]=useState('');
  useEffect(()=>{let active=true;void assessDecision(p,d).then(r=>{if(active)setResult(r);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[p,d]);
  const nodes=pinnedClosure(p,d),selected=d.options.find(o=>o.id===d.selectedOptionId);
  return <article className="decision-card"><div className="eyebrow">{refKey(d)} · {d.createdBy}</div><span className="badge amber">{result?.needsReview?'待复核':d.state==='recorded'?'已记录研究选择':d.state==='draft'?'草稿':'待复核'}</span><h3>{d.question}</h3>
    <p><strong>{selected?'当前倾向：'+selected.summary:'尚未选择'}</strong></p><p>{d.rationale||'选择理由待填写'}</p>
    <p className="warning">{d.personalReview&&!d.personalReview.imported?'有本人自述确认记录；非企业审批':'AI辅助或待本人最终确认；不计个人商业成果'}</p>
    <div className="decision-options">{d.options.map(o=><div key={o.id}><strong>{o.id} · {o.summary}</strong><p>{o.messageRefs.map(refKey).join('、')||'暂缓 / 未绑定'}</p></div>)}</div>
    <p>取舍：{d.tradeoffs.join('；')||'待填写'}</p><p>反证：{d.counterRefs.map(refKey).join('、')||d.counterSearchNote||'尚未说明'}</p><p>风险：{d.unresolvedGaps.join('；')||'尚未说明'}</p><p>重审条件：{d.revisitTriggers.join('；')||'尚未说明'}</p>
    {d.nextSteps.map((s,i)=><p key={i}>拟议验证：{s.action} · {s.owner} · {s.dueDate??'日期待定'} · 判断规则：{s.criterion}</p>)}
    {error&&<p role="alert">{error}</p>}{result&&<ul className="warning">{[...result.errors,...result.warnings].map((x,i)=><li key={i}>{x}</li>)}</ul>}
    <details><summary>查看绑定的证据与版本</summary><div className="toolbar">{nodes.map(e=>'evidenceLinks' in e?<button key={refKey(e)} onClick={()=>onFact(e)}>{refKey(e)} 证据</button>:<span key={refKey(e)}>{refKey(e)}</span>)}</div></details>
    <div className="toolbar"><button disabled={locked} onClick={onEdit}>编辑决定 {d.id}</button><button onClick={()=>onBrief(asRef(d))}>生成此决定简报</button></div>
    <details><summary>历史决定与变更理由</summary>{p.decisions.filter(x=>x.id===d.id).map(x=><article key={refKey(x)}><strong>{refKey(x)} · 当时状态 {x.state}</strong><p>{x.rationale||'草稿'} · {x.changeReason}</p><p>当时选择：{x.selectedOptionId??'未选'}；引用：{x.options.flatMap(o=>o.messageRefs.map(refKey)).join('、')}</p><button onClick={()=>onBrief(asRef(x))}>导出历史 {refKey(x)} 草稿</button></article>)}</details>
  </article>;
}
