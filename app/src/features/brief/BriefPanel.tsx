import { useEffect, useState } from 'react';
import type { Author, Fact, Project, Ref } from '../../domain/entities';
import { refKey } from '../../domain/refs';
import { createBrief, inspectBrief } from '../../application/exportBrief';
import type { Language, Mode } from '../../application/exportBrief';
import { downloadText } from '../../infrastructure/importExport';
export function BriefPanel({project:p,author,initialRef,onFact,onLedger}:{project:Project;author:Author;initialRef:Ref|null;onFact:(f:Fact)=>void;onLedger:()=>void}){
  const [selected,setSelected]=useState(initialRef?refKey(initialRef):p.decisions.at(-1)?refKey(p.decisions.at(-1)!):'');
  const [language,setLanguage]=useState<Language>('bilingual'),[mode,setMode]=useState<Mode>('draft'),[personal,setPersonal]=useState(false);
  const [check,setCheck]=useState<Awaited<ReturnType<typeof inspectBrief>>|null>(null),[preview,setPreview]=useState<Awaited<ReturnType<typeof createBrief>>|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const d=p.decisions.find(x=>refKey(x)===selected);
  const request=()=>({language,mode,generatedAt:new Date().toISOString(),author,semanticConfirmed:personal});
  useEffect(()=>{setPreview(null);setCheck(null);setError('');if(!d)return;let active=true;void inspectBrief(p,d,{language,mode,generatedAt:new Date().toISOString(),author,semanticConfirmed:personal}).then(r=>{if(active)setCheck(r);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[p,d,language,mode,personal,author]);
  const validPreview=preview&&preview.snapshot.projectRevision===p.projectRevision&&refKey(preview.snapshot.decisionRef)===selected&&preview.snapshot.language===language&&preview.snapshot.mode===mode;
  const download=(kind:'md'|'json')=>{try{if(!validPreview)throw new Error('输入已变化，请重新生成预览');downloadText(kind==='md'?preview.markdown:preview.json,preview.filename+'.'+kind,kind==='md'?'text/markdown':'application/json');setNotice('已发起'+kind+'下载，请检查实际文件。JSON含完整项目可导入恢复；导入后需重新核查。');}catch(e){setError(String(e));}};
  return <section aria-label="GTM简报"><div className="eyebrow">TRACEABLE GTM BRIEF</div><h2>让选择、限制与来源一起导出</h2>
    {!p.decisions.length?<p className="empty">先创建一个决定草稿。<button onClick={onLedger}>前往决策记录</button></p>:<>
      <div className="brief-controls"><label>决定版本<select value={selected} onChange={e=>setSelected(e.target.value)}>{[...p.decisions].reverse().map(x=><option key={refKey(x)} value={refKey(x)}>{refKey(x)} · {x.state} · {x.question}</option>)}</select></label>
      <label>简报语言<select value={language} onChange={e=>setLanguage(e.target.value as Language)}><option value="bilingual">中英文双语</option><option value="zh">中文</option><option value="en">English</option></select></label>
      <label>导出模式<select value={mode} onChange={e=>setMode(e.target.value as Mode)}><option value="draft">研究草稿（披露缺口）</option><option value="reviewed">作者已复核（非企业批准）</option></select></label></div>
      <p className="warning">未验证人群、历史证据、英文缺失都要披露。已知材料提供标记为AI辅助的英文草稿；新增自由文本不自动翻译，不补造个人贡献。完整双语已复核模式需补齐英文并由本人核对含义；草稿可保留原文并标缺失。</p>
      {mode==='reviewed'&&<label className="checkline"><input type="checkbox" disabled={author!=='self'} checked={personal} onChange={e=>setPersonal(e.target.checked)}/>本人已核对简报含义、双语限定语和贡献边界</label>}
      {check&&<div className="review-state"><h3>导出前检查</h3><p>英文缺项 {check.missing.length} · 数字不一致 {check.mismatches.length}</p>{check.blockers.length>0&&<ul className="error">{check.blockers.map(x=><li key={x}>{x}</li>)}</ul>}<details><summary>查看缺口与待复核事项</summary><ul>{check.warnings.map(x=><li key={x}>{x}</li>)}</ul><ul>{check.missing.map(f=><li key={f.key}>{f.key} · {f.label}</li>)}</ul><button onClick={onLedger}>返回决策记录补充英文或修正引用</button></details>
      <div className="toolbar">{check.sections.filter(s=>s.kind.startsWith('Fact')).map(s=><button key={refKey(s.ref)} onClick={()=>{const f=p.facts.find(x=>refKey(x)===refKey(s.ref));if(f)onFact(f);}}>核对导出 {refKey(s.ref)}</button>)}</div></div>}
      <div className="toolbar"><button className="primary" disabled={!d||busy||!check||!!check.blockers.length} onClick={async()=>{setBusy(true);setError('');try{setPreview(await createBrief(p,d!,request()));}catch(e){setError(String(e));}finally{setBusy(false);}}}>生成简报预览</button><button disabled={!validPreview} onClick={()=>download('md')}>下载Markdown简报</button><button disabled={!validPreview} onClick={()=>download('json')}>下载JSON快照</button></div>
      {error&&<p role="alert" className="error">{error}</p>}<p role="status">{notice}</p>
      {validPreview?<><p className="snapshot-fingerprint">冻结预览：项目r{preview.snapshot.projectRevision} · {selected} · {preview.snapshot.inputFingerprint}</p><pre className="brief-preview">{preview.markdown}</pre></>:<p className="muted">尚无当前有效预览；输入、模式或项目变化后必须重新生成。</p>}
    </>}
  </section>;
}
