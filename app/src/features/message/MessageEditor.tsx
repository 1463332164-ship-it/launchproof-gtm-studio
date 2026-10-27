import { useState } from 'react';
import type { Message, Project } from '../../domain/entities';
import { EditorDialog } from '../../components/EditorDialog';
import { asRef, latest, pinnedEntity, refKey } from '../../domain/refs';
import { refsFromText } from '../../domain/messageReview';
import { currentMessageRefs } from '../../application/projectCommands';
import { DIMENSIONS } from '../../domain/comparison';
export function MessageEditor({item,project,onClose,onSave}:{item:Message;project:Project;onClose:()=>void;onSave:(m:Message,reason:string)=>Promise<void>}) {
  const [draft,setDraft]=useState(structuredClone(item));const [refs,setRefs]=useState(Object.fromEntries(item.claimItems.map(c=>[c.id,c.basisRefs.map(refKey).join(', ')])));
  const [reason,setReason]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const hypotheses=latest(project.hypotheses).filter(h=>!h.archived);const barriers=latest(project.barriers).filter(b=>!b.archived);
  const changeClaim=(index:number,key:string,value:unknown)=>setDraft({...draft,claimItems:draft.claimItems.map((c,i)=>i===index?{...c,[key]:value}:c)});
  const parse=():Message=>({...draft,claimItems:draft.claimItems.map(c=>({...c,basisRefs:refsFromText(refs[c.id]??'')}))});
  const field=(key:'headlineZh'|'headlineEn'|'valuePropositionZh'|'valuePropositionEn'|'callToAction',label:string)=><label>{label}<textarea required={key.endsWith('Zh')||key==='callToAction'} value={draft[key]??''} onChange={e=>setDraft({...draft,[key]:e.target.value||null})}/></label>;
  return <EditorDialog title={'编辑信息方案 '+item.id} onClose={onClose} dirty={JSON.stringify(draft)!==JSON.stringify(item)||JSON.stringify(refs)!==JSON.stringify(Object.fromEntries(item.claimItems.map(c=>[c.id,c.basisRefs.map(refKey).join(', ')])))||!!reason}>
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onSave(parse(),reason);}catch(e){setError(String(e));}finally{setBusy(false);}}}><p className="warning">研究草案 / AI辅助起稿。保存后重新审核；不是品牌批准或可直接发布的广告。</p>
      <label>目标人群假设<select value={draft.segmentHypothesisRef.id} onChange={e=>setDraft({...draft,segmentHypothesisRef:asRef(hypotheses.find(h=>h.id===e.target.value)!)})}>{hypotheses.map(h=><option key={h.id} value={h.id}>{h.id}@{h.revision} {h.segment}</option>)}</select></label>
      <fieldset><legend>关联购买障碍</legend>{barriers.map(b=><label className="checkline" key={b.id}><input type="checkbox" checked={draft.barrierRefs.some(r=>r.id===b.id)} onChange={e=>setDraft({...draft,barrierRefs:e.target.checked?[...draft.barrierRefs,asRef(b)]:draft.barrierRefs.filter(r=>r.id!==b.id)})}/>{b.id} {b.label}</label>)}</fieldset>
      <button type="button" onClick={()=>{try{const rebound=currentMessageRefs(project,parse());setDraft(rebound);setRefs(Object.fromEntries(rebound.claimItems.map(c=>[c.id,c.basisRefs.map(refKey).join(', ')])));}catch(e){setError(String(e));}}}>更新方案引用到当前版本（仍需审核）</button>
      {field('headlineZh','中文标题')}{field('headlineEn','英文标题')}{field('valuePropositionZh','中文价值主张')}{field('valuePropositionEn','英文价值主张')}
      {draft.claimItems.map((claim,index)=><fieldset key={claim.id}><legend>{claim.id} · 主张 {index+1}</legend>
        <label>主张类型 {index+1}<select value={claim.kind} onChange={e=>changeClaim(index,'kind',e.target.value)}><option value="fact">事实：必须有合格Fact</option><option value="inference">分析推断：非官方原话</option><option value="hypothesis">假设：非用户发现</option></select></label>
        <label>中文主张 {index+1}<textarea required value={claim.textZh} onChange={e=>changeClaim(index,'textZh',e.target.value)}/></label>
        <label>英文主张 {index+1}<textarea value={claim.textEn??''} onChange={e=>changeClaim(index,'textEn',e.target.value||null)}/></label>
        <label>主张依据 {index+1}（ID@版本）<input value={refs[claim.id]??''} onChange={e=>setRefs({...refs,[claim.id]:e.target.value})}/></label>
        <label>中文限定语 {index+1}<textarea value={claim.qualifierZh??''} onChange={e=>changeClaim(index,'qualifierZh',e.target.value||null)}/></label>
        <button type="button" onClick={()=>{try{const conditions=refsFromText(refs[claim.id]??'').flatMap(r=>{const f=pinnedEntity(project,r);return f&&'conditions' in f?f.conditions:[];});changeClaim(index,'qualifierZh',conditions.join(' ')||claim.qualifierZh);}catch(e){setError(String(e));}}}>带入事实适用条件 {index+1}</button>
        <label>英文限定语 {index+1}<textarea value={claim.qualifierEn??''} onChange={e=>changeClaim(index,'qualifierEn',e.target.value||null)}/></label>
        <label className="checkline"><input type="checkbox" checked={!!claim.comparisonScope} onChange={e=>changeClaim(index,'comparisonScope',e.target.checked?{dimension:'diameter',productRefs:[project.mission.focalProductRef,...project.mission.competitorRefs],conditions:'同US市场、同评估日、官方标称条件；非体验排名。'}:null)}/>这是比较两款产品的主张 {index+1}</label>
        {claim.comparisonScope&&<><label>比较维度 {index+1}<select value={claim.comparisonScope.dimension} onChange={e=>changeClaim(index,'comparisonScope',{...claim.comparisonScope,dimension:e.target.value})}>{DIMENSIONS.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label><label>同口径条件 {index+1}<textarea required value={claim.comparisonScope.conditions} onChange={e=>changeClaim(index,'comparisonScope',{...claim.comparisonScope,conditions:e.target.value})}/></label></>}
        <button type="button" disabled={draft.claimItems.length===1} onClick={()=>setDraft({...draft,claimItems:draft.claimItems.filter((_,i)=>i!==index)})}>移除主张 {index+1}</button>
      </fieldset>)}
      <button type="button" disabled={draft.claimItems.length>=20} onClick={()=>setDraft({...draft,claimItems:[...draft.claimItems,{id:'C-'+crypto.randomUUID().slice(0,8),kind:'hypothesis',textZh:'待填写的假设草案',textEn:null,basisRefs:[],qualifierZh:null,qualifierEn:null,comparisonScope:null,humanMeaningReview:false}]})}>添加主张</button>
      {field('callToAction','下一步行动 CTA')}<label>修改理由<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert" className="error">{error}</p>}<button disabled={busy} className="primary">保存信息草案</button>
    </form>
  </EditorDialog>;
}

