import { useState } from 'react';
import type { Barrier, Hypothesis, Weights } from '../../domain/entities';
import { DEFAULT_WEIGHTS, normalizeWeights, rankBarriers, SCORE_KEYS, sensitivity } from '../../domain/priority';
import { EditorDialog } from '../../components/EditorDialog';
export const SCORE_LABELS={impact:'潜在影响',relevance:'任务关联',actionability:'信息可处理程度'};
const scoreText=(v:number|null)=>v===null?'未知':v.toFixed(1);
export function PriorityPanel({barriers,onWeights,locked}:{barriers:Barrier[];onWeights:(w:Weights,reason:string)=>Promise<void>;locked:boolean}) {
  const initial=barriers[0]?.weights??DEFAULT_WEIGHTS;
  const [weights,setWeights]=useState<Weights>(initial);const [reason,setReason]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  let result:ReturnType<typeof rankBarriers>|null=null;let cases:ReturnType<typeof sensitivity>=[];let validation='';
  try{result=rankBarriers(barriers,weights);cases=sensitivity(barriers,weights);}catch(e){validation=String(e);}
  const mixed=barriers.some(b=>JSON.stringify(normalizeWeights(b.weights))!==JSON.stringify(normalizeWeights(initial)));
  return <section className="priority-panel"><h3>先研究哪个障碍？</h3><p>0无、1低、2中、3高、4关键。分数和权重是设计判断，不是消费者发生率；缺分只给区间，不作确定排名。</p>
    {mixed&&<p className="warning">现存障碍权重不一致；下方仅为统一权重预览，保存后再作同口径排序。</p>}
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onWeights(weights,reason);setError('');setReason('');}catch(e){setError(String(e));}finally{setBusy(false);}}}><div className="weight-controls">{SCORE_KEYS.map(k=><label key={k}>{SCORE_LABELS[k]}权重<input type="number" min="0" step="any" required value={Number.isNaN(weights[k])?'':weights[k]} onChange={e=>setWeights({...weights,[k]:e.target.value===''?NaN:Number(e.target.value)})}/></label>)}</div>
      <label>权重修改理由<input required value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={locked||busy||!barriers.length||!!validation}>保存统一权重新版本</button></form>
    <p className="muted">预览不覆盖旧设置；默认0.5 / 0.3 / 0.2，计算前归一化。保存会使引用这些障碍的信息方案待复核。</p>
    {(validation||error)&&<p role="alert" className="error">{validation||error}</p>}
    {result&&<><div className="rank-results">{result.ranked.map((b,i)=><p key={b.id}><strong>{i+1}. {b.label} · {scoreText(b.point)}</strong> {b.tied?'并列':b.nearTie?'近似并列（差≤1分）':''} · 设计评分 / 未验证</p>)}{result.unranked.map(b=><p key={b.id}>{b.label}：{b.min.toFixed(1)}–{b.max.toFixed(1)}，评分缺项，不参与确定排名</p>)}</div>
      <details open><summary>6组单权重敏感性 · 非市场验证</summary><div className="sensitivity-grid">{cases.map(row=><article key={row.key+row.multiplier}><strong>{SCORE_LABELS[row.key]} {row.multiplier===.8?'−20%':'+20%'}</strong><p>归一化：{SCORE_KEYS.map(k=>row.weights[k].toFixed(3)).join(' / ')}</p>{row.results.map(b=><p key={b.id}>{b.id}：{b.point===null?b.min.toFixed(1)+'–'+b.max.toFixed(1):b.point.toFixed(1)}{row.ranked.find(x=>x.id===b.id)?.nearTie?' · 近似并列':''}</p>)}<small>{row.leaders.length?'首位：'+row.leaders.join('、')+(row.leaderChanged?'（变化）':'（未变）'):'无完整评分，不能确定首位'}</small></article>)}</div></details>
    </>}
  </section>;
}
export function BarrierEditor({item,hypotheses,onClose,onSave}:{item:Barrier;hypotheses:Hypothesis[];onClose:()=>void;onSave:(b:Barrier,reason:string)=>Promise<void>}) {
  const [draft,setDraft]=useState(structuredClone(item));const [reason,setReason]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  return <EditorDialog title="编辑障碍评分" onClose={onClose} dirty={JSON.stringify(draft)!==JSON.stringify(item)||!!reason}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onSave(draft,reason);}catch(e){setError(String(e));}finally{setBusy(false);}}}>
    <p className="warning">设计评分，不代表真实痛点频率。每个分数必须说明理由。</p><label>障碍名称<input required value={draft.label} onChange={e=>setDraft({...draft,label:e.target.value})}/></label>
    <label>对应假设<select value={draft.hypothesisRef.id} onChange={e=>{const h=hypotheses.find(h=>h.id===e.target.value)!;setDraft({...draft,hypothesisRef:{id:h.id,revision:h.revision}});}}>{hypotheses.map(h=><option key={h.id} value={h.id}>{h.id}@{h.revision} {h.statement}</option>)}</select></label><button type="button" onClick={()=>{const h=hypotheses.find(h=>h.id===draft.hypothesisRef.id);if(h)setDraft({...draft,hypothesisRef:{id:h.id,revision:h.revision}});}}>更新障碍的假设引用</button>
    {SCORE_KEYS.map(k=><fieldset key={k}><legend>{SCORE_LABELS[k]}</legend><label>{SCORE_LABELS[k]}评分<select value={draft[k]??''} onChange={e=>setDraft({...draft,[k]:e.target.value===''?null:Number(e.target.value)})}><option value="">未知 / 未评分</option>{[0,1,2,3,4].map(v=><option key={v} value={v}>{v}</option>)}</select></label><label>{SCORE_LABELS[k]}理由<textarea required={draft[k]!==null} value={draft.scoreRationale[k]} onChange={e=>setDraft({...draft,scoreRationale:{...draft.scoreRationale,[k]:e.target.value}})}/></label></fieldset>)}
    <label>证据状态与局限<textarea required value={draft.evidenceNote} onChange={e=>setDraft({...draft,evidenceNote:e.target.value})}/></label><label>修改理由<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert" className="error">{error}</p>}<button disabled={busy} className="primary">保存障碍评分</button>
  </form></EditorDialog>;
}

