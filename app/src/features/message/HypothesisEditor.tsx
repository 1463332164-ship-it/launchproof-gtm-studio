import { useState } from 'react';
import type { Hypothesis, Project, Ref } from '../../domain/entities';
import { EditorDialog } from '../../components/EditorDialog';
import { currentEntity, asRef, refKey } from '../../domain/refs';
import { refsFromText } from '../../domain/messageReview';
export function newHypothesis(refs:Ref[],context:string,now:string):Hypothesis {
  return {id:'H-'+crypto.randomUUID().slice(0,8),revision:1,createdAt:now,updatedAt:now,createdBy:'ai_assisted',archived:false,
    statement:'',segment:'',context,basisRefs:refs,basisNote:'从比较条件提出的设计假设，尚无用户观察。',falsificationCriterion:'',
    validationPlan:{method:'拟议任务观察（未执行）',recruitmentCriteria:'有美国使用情境并实际考虑窗帘自动化的人',task:'',measure:'',decisionRule:'',plannedSampleSize:5},
    researchStatus:'untested',actualSampleSize:0,observationRefs:[],owner:'待用户指定',nextReviewDate:null};
}
export function HypothesisEditor({item,project,onClose,onSave}:{item:Hypothesis;project:Project;onClose:()=>void;onSave:(h:Hypothesis,reason:string)=>Promise<void>}) {
  const [draft,setDraft]=useState(structuredClone(item));const [refs,setRefs]=useState(item.basisRefs.map(refKey).join(', '));const [reason,setReason]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const field=(key:'statement'|'segment'|'context'|'basisNote'|'falsificationCriterion'|'owner',label:string)=><label>{label}<textarea required value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>;
  return <EditorDialog title="编辑未验证假设" onClose={onClose} dirty={JSON.stringify(draft)!==JSON.stringify(item)||refs!==item.basisRefs.map(refKey).join(', ')||!!reason}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onSave({...draft,basisRefs:refsFromText(refs)},reason);}catch(e){setError(String(e));}finally{setBusy(false);}}}>
    <p className="warning">{item.id} · 假设，非用户反馈。实际样本0；拟议样本量不是已完成研究。</p>
    {field('statement','可证伪命题')}{field('segment','目标人群假设')}{field('context','使用情境')}{field('falsificationCriterion','反证 / 缩小条件')}
    <label>依据引用（ID@版本，可留空）<input value={refs} onChange={e=>setRefs(e.target.value)}/></label><button type="button" onClick={()=>{try{setRefs(refsFromText(refs).map(r=>asRef(currentEntity(project,r)??r)).map(refKey).join(', '));}catch(e){setError(String(e));}}}>更新假设依据到当前版本</button>
    {field('basisNote','设计依据与局限')}
    <fieldset><legend>拟议验证计划 · 未执行</legend>{(['method','recruitmentCriteria','task','measure','decisionRule'] as const).map((key,i)=><label key={key}>{['研究方法','招募条件','观察任务','观察指标','事前决策规则'][i]}<textarea required value={draft.validationPlan[key]} onChange={e=>setDraft({...draft,validationPlan:{...draft.validationPlan,[key]:e.target.value}})}/></label>)}<label>拟议样本量（设计假设）<input type="number" required min="1" max="1000" value={draft.validationPlan.plannedSampleSize} onChange={e=>setDraft({...draft,validationPlan:{...draft.validationPlan,plannedSampleSize:Number(e.target.value)}})}/></label></fieldset>
    {field('owner','拟议责任人')}<label>下次复核日（未知留空）<input type="date" value={draft.nextReviewDate??''} onChange={e=>setDraft({...draft,nextReviewDate:e.target.value||null})}/></label>
    <label>修改理由<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert" className="error">{error}</p>}<button disabled={busy} className="primary">保存假设新版本</button>
  </form></EditorDialog>;
}

