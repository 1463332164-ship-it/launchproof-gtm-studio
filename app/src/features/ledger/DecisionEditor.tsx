import { useState } from 'react';
import type { Author, Decision, Project } from '../../domain/entities';
import { latest, refKey } from '../../domain/refs';
import { rebindDecision } from '../../domain/decision';
import { refsFromText } from '../../domain/messageReview';
import { briefSections } from '../../application/exportBrief';
import { EditorDialog } from '../../components/EditorDialog';
const lines=(s:string)=>s.split('\n');
const clean=(xs:string[])=>xs.map(x=>x.trim()).filter(Boolean);
export function DecisionEditor({item,project:p,author,onClose,onSave}:{item:Decision;project:Project;author:Author;onClose:()=>void;onSave:(d:Decision,reason:string,recorded:boolean,personal:boolean)=>Promise<void>}) {
  const [d,setD]=useState(structuredClone(item)),[reason,setReason]=useState(''),[personal,setPersonal]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [support,setSupport]=useState(item.supportingRefs.map(refKey).join(', ')),[counter,setCounter]=useState(item.counterRefs.map(refKey).join(', '));
  const set=(patch:Partial<Decision>)=>setD({...d,...patch});
  const save=async(recorded:boolean)=>{setBusy(true);setError('');try{await onSave({...d,tradeoffs:clean(d.tradeoffs),unresolvedGaps:clean(d.unresolvedGaps),revisitTriggers:clean(d.revisitTriggers),supportingRefs:refsFromText(support),counterRefs:refsFromText(counter)},reason,recorded,personal);}catch(e){setError(String(e));}finally{setBusy(false);}};
  let translationFields:ReturnType<typeof briefSections>[number]['fields']=[];
  try{translationFields=briefSections({...p,decisions:[...p.decisions.filter(x=>refKey(x)!==refKey(d)),d]},d).flatMap(s=>s.fields);}catch{/* Incomplete draft shows reference errors on save. */}
  return <EditorDialog title="记录研究选择" onClose={onClose} dirty={JSON.stringify(d)!==JSON.stringify(item)||!!reason||support!==item.supportingRefs.map(refKey).join(', ')||counter!==item.counterRefs.map(refKey).join(', ')}>
    <form onSubmit={e=>{e.preventDefault();void save(true);}}>
      <p className="warning">已记录不等于商业效果已验证。AI辅助记录属于建议；本人确认需由你实际操作。未合格消息可以保留为未选材料；也可选择暂缓。</p>
      <label>决策问题<textarea required value={d.question} onChange={e=>set({question:e.target.value})}/></label>
      <label>用途<select value={d.purpose} onChange={e=>set({purpose:e.target.value as Decision['purpose']})}><option value="research_only">仅供研究，商业效果待验证</option><option value="external_message">拟作为对外信息（需本人及信息复核）</option></select></label>
      <h3>备选方案与当前引用</h3>
      {d.options.map((o,i)=><fieldset key={o.id}><legend>候选 {o.id}</legend>
        <label>候选说明 {i+1}<textarea required value={o.summary} onChange={e=>set({options:d.options.map(x=>x.id===o.id?{...x,summary:e.target.value}:x)})}/></label>
        <label>候选类型 {i+1}<select value={o.kind} onChange={e=>set({options:d.options.map(x=>x.id===o.id?{...x,kind:e.target.value as 'message'|'defer',messageRefs:[]}:x)})}><option value="message">信息方案</option><option value="defer">暂缓决定 / 先补证据</option></select></label>
        {o.kind==='message'&&<label>绑定信息 {i+1}<select value={o.messageRefs[0]?refKey(o.messageRefs[0]):''} onChange={e=>set({options:d.options.map(x=>x.id===o.id?{...x,messageRefs:refsFromText(e.target.value)}:x)})}><option value="">尚未选择</option>{latest(p.messages).filter(m=>!m.archived).map(m=><option key={m.id} value={refKey(m)}>{refKey(m)} · {m.headlineZh} · {m.reviewState}</option>)}</select><small>保留引用：{o.messageRefs.map(refKey).join(', ')||'暂无'}</small></label>}
        <button type="button" onClick={()=>set({options:d.options.filter(x=>x.id!==o.id),selectedOptionId:d.selectedOptionId===o.id?null:d.selectedOptionId})}>移除候选 {i+1}</button>
      </fieldset>)}
      <button type="button" onClick={()=>set({options:[...d.options,{id:'O-'+crypto.randomUUID().slice(0,6),summary:'暂缓：先补证据',kind:'defer',messageRefs:[],scenarioRefs:[]}]})}>增加暂缓候选</button>
      <button type="button" onClick={()=>{try{const updated=rebindDecision(p,{...d,supportingRefs:refsFromText(support),counterRefs:refsFromText(counter)});setD(updated);setSupport(updated.supportingRefs.map(refKey).join(', '));setCounter(updated.counterRefs.map(refKey).join(', '));setError('');}catch(e){setError(String(e));}}}>更新直接引用到当前版本（不自动重审）</button>
      <label>本次选择<select value={d.selectedOptionId??''} onChange={e=>set({selectedOptionId:e.target.value||null})}><option value="">尚未选择</option>{d.options.map(o=><option key={o.id} value={o.id}>{o.id} · {o.summary}</option>)}</select></label>
      <label>选择理由<textarea value={d.rationale} onChange={e=>set({rationale:e.target.value})}/></label>
      <label>未选理由与取舍（每行一条）<textarea value={d.tradeoffs.join('\n')} onChange={e=>set({tradeoffs:lines(e.target.value)})}/></label>
      <label>支持引用（ID@版本，可留空）<input value={support} onChange={e=>setSupport(e.target.value)}/></label>
      <label>反证引用（ID@版本，可留空）<input value={counter} onChange={e=>setCounter(e.target.value)}/></label>
      <label>寻找反证的说明<textarea value={d.counterSearchNote} onChange={e=>set({counterSearchNote:e.target.value})}/></label>
      <label>未决事项与风险（每行一条）<textarea value={d.unresolvedGaps.join('\n')} onChange={e=>set({unresolvedGaps:lines(e.target.value)})}/></label>
      <label>重新核查触发（每行一条）<textarea value={d.revisitTriggers.join('\n')} onChange={e=>set({revisitTriggers:lines(e.target.value)})}/></label>
      <label>决策责任归属<input value={d.owner} onChange={e=>set({owner:e.target.value})}/></label>
      <h3>下一步验证 · 尚未执行</h3>
      {d.nextSteps.map((step,i)=><fieldset key={i}><legend>验证任务 {i+1}</legend>
        {(['action','owner','criterion','dueDate'] as const).map(k=><label key={k}>{{action:'验证动作',owner:'拟议责任人',criterion:'事前判断规则',dueDate:'拟议日期'}[k]} {i+1}<input type={k==='dueDate'?'date':'text'} value={step[k]??''} onChange={e=>set({nextSteps:d.nextSteps.map((x,j)=>j===i?{...x,[k]:e.target.value|| (k==='dueDate'?null:'')}:x)})}/></label>)}
        <button type="button" onClick={()=>set({nextSteps:d.nextSteps.filter((_,j)=>j!==i)})}>移除验证任务 {i+1}</button></fieldset>)}
      <button type="button" onClick={()=>set({nextSteps:[...d.nextSteps,{action:'',owner:'',criterion:'',dueDate:null}]})}>增加验证任务</button>
      <details><summary>英文补充（可后补；缺失仅导出标缺失草稿）</summary><p>已知原文的AI英文草稿仍待本人核查；新增自由文本需补充，不能增强主张。补充绑定实体版本。</p>{translationFields.map(f=><label key={f.key}>{f.key} · {f.label} · {f.translationOrigin}<small>{f.zh}</small><textarea value={d.english[f.key]??f.en??''} onChange={e=>{const english={...d.english};if(e.target.value.trim())english[f.key]=e.target.value;else delete english[f.key];set({english});}}/></label>)}</details>
      <label>本次变更理由<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <label className="checkline"><input type="checkbox" disabled={author!=='self'} checked={personal} onChange={e=>setPersonal(e.target.checked)}/>本人实际确认此选择及其依据、风险和双语含义</label>
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="toolbar"><button type="button" disabled={busy} onClick={()=>void save(false)}>保存决定草稿</button><button className="primary" disabled={busy}>检查并记录选择</button></div>
    </form>
  </EditorDialog>;
}
