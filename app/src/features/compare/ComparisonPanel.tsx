import { useState } from 'react';
import type { Fact, Project, Ref } from '../../domain/entities';
import { buildComparison } from '../../domain/comparison';
import { refKey } from '../../domain/refs';
export function ComparisonPanel({project,onFact,onHypothesis,locked}:{project:Project;onFact:(f:Fact)=>void;onHypothesis:(refs:Ref[],context:string)=>void;locked:boolean}) {
  const [filter,setFilter]=useState('all'); const rows=buildComparison(project);
  return <section aria-label="六维竞品比较"><div className="section-heading"><div><div className="eyebrow">COMPARE CONDITIONS</div><h2>从规格差异，找到研究问题</h2></div><label>比较筛选<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部六维</option><option value="unknown">仅看未知</option><option value="different">仅看差异</option></select></label></div>
    <p className="warning">US · {project.mission.asOfDate} 研究快照。比较条件，不评品牌总分；未知不等于不支持，尺寸符合不等于完整可安装。</p>
    {rows.filter(row=>filter==='all'||filter==='unknown'&&row.hasUnknown||filter==='different'&&row.hasDifference).map(row=><article className="comparison-row" key={row.id}><h3>{row.label} <span className="badge amber">{row.status}</span></h3><p>{row.note}</p><div className="compare-cells">{row.cells.map(cell=><section className="comparison-cell" key={cell.product.id}><h4>{cell.product.brand} {cell.product.modelName} · {cell.product.variant}</h4><span className="badge">{cell.status}</span><p className="comparison-value">{cell.summary}</p>
      {cell.facts.map(f=><div key={f.id}><button onClick={()=>onFact(f)}>核对 {refKey(f)} · {row.label}</button><ul className="muted">{f.conditions.map((c,i)=><li key={i}>{c}</li>)}</ul></div>)}
      {cell.sourceRefs.map(r=>{const s=project.sources.find(x=>refKey(x)===refKey(r));return s&&<p key={refKey(r)}><a href={s.url} target="_blank" rel="noreferrer">{s.title}（信息入口）</a><span> · {s.accessStatus}，不是库存证明</span></p>;})}
      <button disabled={locked} onClick={()=>onHypothesis(cell.basisRefs,row.label+' / '+cell.product.variant)}>转为障碍假设 · {row.label} · {cell.product.brand}</button>
    </section>)}</div></article>)}
  </section>;
}

