import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Author, Fact, Hypothesis, Mission, Project, Source, Decision, Ref } from './domain/entities';
import { currentFacts, latest, refKey } from './domain/validation';
import { assessEvidence } from './domain/evidence';
import { referencedBy } from './domain/provenance';
import { archiveEntity, editMission, recordMeaningReview, replaceProject, saveEntity } from './application/projectCommands';
import { seedProject, store, testNamespace, practiceNamespace, useWorkspace } from './application/useWorkspace';
import { downloadText, previewImport, readImportFile, serializeProject } from './infrastructure/importExport';
import { FactInspector, labels } from './components/FactInspector';
import { EditorDialog } from './components/EditorDialog';
import { MissionEditor } from './features/mission/MissionEditor';
import { emptyFact, emptySource, EvidenceEditor } from './features/evidence/EvidenceEditor';
import { ComparisonPanel } from './features/compare/ComparisonPanel';
import { ResearchPanel } from './features/message/ResearchPanel';
import { LedgerPanel } from './features/ledger/LedgerPanel';
import { BriefPanel } from './features/brief/BriefPanel';
import { newDecision } from './domain/decision';
import { asRef } from './domain/refs';
import { newHypothesis } from './features/message/HypothesisEditor';

type Editor = { kind: 'facts' | 'sources'; item: Fact | Source; creating: boolean };
export default function App() {
  const w = useWorkspace(); const p = w.project;
  const [author, setAuthor] = useState<Author>('ai_assisted');
  const [selectedId, setSelectedId] = useState('F003'); const [limitedOnly, setLimitedOnly] = useState(false);
  const [view, setView] = useState<'facts' | 'sources' | 'history' | 'compare' | 'research' | 'messages' | 'ledger' | 'brief'>('facts');
  const [decisionDraft,setDecisionDraft]=useState<Decision|null>(null);
  const [briefRef,setBriefRef]=useState<Ref|null>(null);
  const [hypothesisDraft,setHypothesisDraft]=useState<Hypothesis|null>(null);
  const [editor, setEditor] = useState<Editor | null>(null); const [missionEdit, setMissionEdit] = useState<'new' | 'edit' | null>(null);
  const [drawer, setDrawer] = useState<Fact | null>(null); const [review, setReview] = useState<Fact | null>(null);
  const [importOpen, setImportOpen] = useState(false); const [importText, setImportText] = useState(''); const [importError, setImportError] = useState('');
  const [replacement, setReplacement] = useState<{ project: Project; label: string } | null>(null);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [archive, setArchive] = useState<{ kind: 'facts' | 'sources'; id: string } | null>(null);
  const facts = currentFacts(p); const sources = latest(p.sources);
  const limited = facts.filter(f => !assessEvidence(f, p).eligibleForClaim);
  const visible = limitedOnly ? limited : facts; const selected = visible.find(f => f.id === selectedId) ?? visible[0];
  const context = (reason: string) => ({ now: new Date().toISOString(), reason, author });
  function exported() { try { downloadText(serializeProject(p), 'LaunchProof-' + p.projectRevision + '.json'); w.setNotice('已发起JSON下载；请确认浏览器下载文件。包含所有保留版本。'); } catch (e) { w.setNotice(String(e)); } }
  async function replace() {
    if (!replacement) return;
    try { if (await w.commit(replaceProject(p, replacement.project), true)) { setReplacement(null); setImportOpen(false); setImportText(''); setSelectedId('F003'); } }
    catch (e) { w.setNotice(String(e)); }
  }
  const locked = w.busy || w.conflict;
  return <>
    <header className="topbar"><a href="#main" className="wordmark"><span className="brand-icon">L</span>LaunchProof</a><span className="phase">公开预览 · Research prototype</span></header>
    <main id="main" className="workspace">
      <section className="intro"><div><div className="eyebrow">EVIDENCE-BASED HARDWARE GTM</div><h1>让每次修改，都留下依据。</h1><p>两款美国市场杆式设备 · 研究、核查、保存与恢复</p></div><div className="snapshot"><span>证据评估日</span><strong>{p.mission.asOfDate}</strong><span>US · 项目版本 {p.projectRevision}</span></div></section>
      <aside className="preview-note" aria-label="公开预览说明"><strong>公开预览版 · 持续完善中</strong><p>这是AI辅助开发的GTM研究原型。事实有适用范围，用户假设尚未验证，信息方案与研究选择不代表商业效果或发布批准。作者个人业务验收仍待完成。</p><p>操作保存在当前浏览器；没有云端账户同步。请用JSON备份切换研究任务，不要输入私人或企业内部资料。</p><a href="https://github.com/1463332164-ship-it/launchproof-gtm-studio" target="_blank" rel="noreferrer">查看源码与演示指南 ↗</a></aside>
      {practiceNamespace && <p className="warning">个人验收练习副本：独立保存，不影响默认项目。AI准备的材料仍为草案；只有你实际完成的核查与选择才能记为本人操作。</p>}
      {testNamespace && <p className="warning">自动化测试副本：不写入默认项目。操作记录归AI辅助，不代表本人完成核查。</p>}
      <div className="toolbar"><button onClick={() => setMissionEdit('edit')} disabled={locked}>编辑任务</button><button onClick={() => setMissionEdit('new')} disabled={locked}>新建任务</button>
        <button onClick={exported}>导出JSON备份</button><button onClick={() => { setImportOpen(true); setImportError(''); }} disabled={locked}>导入JSON</button>
        <button onClick={() => { try { setReplacement({ project: store.readBackup(), label: '恢复最近有效备份' }); } catch (e) { w.setNotice(String(e)); } }} disabled={locked}>恢复最近备份</button>
        <button onClick={() => setReplacement({ project: seedProject(), label: '重置为原始样例' })} disabled={locked}>重置样例</button>
        <button onClick={() => void w.commit(p)} disabled={locked || !w.dirty || w.invalid}>重试保存</button></div>
      <section className={'save-status ' + (w.dirty || w.conflict ? 'warning' : '')} aria-live="polite"><strong>{w.conflict ? '保存冲突' : w.busy ? '保存中' : w.dirty ? '未保存到本地' : '已保存到本地'}</strong><span>{w.notice}</span>{w.conflict && <button onClick={() => setReloadConfirm(true)}>重新载入本地版本</button>}</section>
      <section className="mission-strip"><div><strong>{p.mission.question}</strong><p>任务 v{p.mission.revision} · {p.mission.state} · 定位对象：{p.products.find(x => x.id === p.mission.focalProductRef.id)?.brand} · 当前事实中有{facts.filter(f => !assessEvidence(f,p).needsReview).length}条本人核查记录（不代表U1整体完成）</p></div>
        <label>本次操作归属<select value={author} onChange={e => setAuthor(e.target.value as Author)}><option value="ai_assisted">AI辅助操作</option><option value="self">本人亲自操作</option></select></label></section>
      <div className="tabs" aria-label="工作区"><button aria-pressed={view === 'facts'} onClick={() => setView('facts')}>事实（{facts.length}）</button><button aria-pressed={view === 'sources'} onClick={() => setView('sources')}>来源（{sources.filter(s => !s.archived).length}）</button><button aria-pressed={view==='compare'} onClick={()=>setView('compare')}>竞品比较</button><button aria-pressed={view==='research'} onClick={()=>setView('research')}>用户假设与障碍</button><button aria-pressed={view==='messages'} onClick={()=>setView('messages')}>信息方案 A/B</button><button aria-pressed={view==='ledger'} onClick={()=>setView('ledger')}>决策记录</button><button aria-pressed={view==='brief'} onClick={()=>setView('brief')}>GTM简报</button><button aria-pressed={view === 'history'} onClick={() => setView('history')}>变更与历史（{p.changeEvents.length}）</button></div>
      {view==='compare'&&<ComparisonPanel project={p} locked={locked} onFact={setDrawer} onHypothesis={(refs,context)=>{setHypothesisDraft(newHypothesis(refs,context,new Date().toISOString()));setView('research');}}/>}
      {(view==='research'||view==='messages')&&<ResearchPanel project={p} author={author} locked={locked} onCommit={w.commit} onFact={setDrawer} view={view} externalHypothesis={hypothesisDraft} closeExternal={()=>setHypothesisDraft(null)} onMessages={()=>setView('messages')} onCandidate={m=>{const candidates=[m,...latest(p.messages).filter(x=>x.id!==m.id&&!x.archived)];setDecisionDraft(newDecision(p,candidates.map(asRef),new Date().toISOString()));setView('ledger');}}/>}
      {view==='ledger'&&<LedgerPanel project={p} author={author} locked={locked} externalDraft={decisionDraft} clearDraft={()=>setDecisionDraft(null)} onCommit={w.commit} onFact={setDrawer} onMessages={()=>setView('messages')} onBrief={r=>{setBriefRef(r);setView('brief');}}/>}
      {view==='brief'&&<BriefPanel key={briefRef?refKey(briefRef):'default'} project={p} author={author} initialRef={briefRef} onFact={setDrawer} onLedger={()=>setView('ledger')}/>}
      {view === 'facts' && <>
        <div className="toolbar"><button className="primary" disabled={locked} onClick={() => setEditor({ kind: 'facts', item: emptyFact(p, new Date().toISOString()), creating: true })}>新增事实</button><label className="checkline"><input type="checkbox" checked={limitedOnly} onChange={e => setLimitedOnly(e.target.checked)} />只看待复核或受限记录（{limited.length}）</label></div>
        <section className="evidence-layout"><nav className="fact-list" aria-label="选择事实"><div className="fact-buttons">{visible.map(f => <button key={f.id} aria-pressed={selected?.id === f.id} className={selected?.id === f.id ? 'selected' : ''} onClick={() => setSelectedId(f.id)}><span className="fact-id">{f.id} · v{f.revision}</span><span className="fact-title">{f.statementZh}</span><span className="fact-state">{labels[assessEvidence(f, p).applicability]} · {assessEvidence(f, p).needsReview ? '待复核' : '已记录核查'}</span></button>)}</div>{!visible.length && <p className="empty">没有符合筛选的事实。</p>}</nav>
          {selected && <div><div className="toolbar"><button disabled={locked} onClick={() => setEditor({ kind: 'facts', item: selected, creating: false })}>编辑当前事实</button><button onClick={() => setDrawer(selected)}>打开证据抽屉</button><button disabled={locked} onClick={() => setReview(selected)}>记录语义核查</button><button disabled={locked} onClick={() => setArchive({ kind: 'facts', id: selected.id })}>归档当前事实</button></div><FactInspector fact={selected} project={p} /></div>}
        </section>
      </>}
      {view === 'sources' && <section><div className="toolbar"><button className="primary" disabled={locked} onClick={() => setEditor({ kind: 'sources', item: emptySource(new Date().toISOString()), creating: true })}>新增来源</button></div><div className="source-grid">{sources.map(s => <article className="source-card" key={s.id}><div className="eyebrow">{s.id} · v{s.revision} · {s.market} · {s.accessStatus}{s.archived ? ' · 已归档' : ''}</div><h2>{s.title}</h2><p>{s.summary}</p><p className="muted">{s.limitation}</p><p>引用位置：{referencedBy(p, s.id).join('、') || '暂无引用'}</p><a href={s.url} target="_blank" rel="noreferrer">查看来源原文</a><div className="toolbar"><button disabled={locked} onClick={() => setEditor({ kind: 'sources', item: s, creating: false })}>编辑来源 {s.id}</button><button disabled={locked} onClick={() => setArchive({ kind: 'sources', id: s.id })}>{s.archived ? '恢复来源' : '归档来源'} {s.id}</button></div></article>)}</div></section>}
      {view === 'history' && <section className="history-panel"><h2>修改理由与影响范围</h2><p>历史不可覆盖；待复核来自任务、事实、来源、假设与评分变化。信息方案保留旧版本；相关决定与简报预览需重新检查；已下载历史文件不会被远程修改。</p>{[...p.changeEvents].reverse().map(event => <article key={event.id}><strong>{event.entityRefAfter.id}@{event.entityRefAfter.revision} · {event.authorType === 'self' ? '本人操作记录' : 'AI辅助记录'}</strong><p>{event.reason}</p><small>{event.occurredAt} · 受影响：{event.affectedRefs.map(refKey).join('、') || '无已存在的下游实体'}</small></article>)}{!p.changeEvents.length && <p>尚无修改记录；不预填开发历史。</p>}
        <h3>已归档事实</h3>{latest(p.facts).filter(f => f.archived).map(f => <p key={f.id}>{f.id} {f.statementZh} <button disabled={locked} onClick={() => setArchive({ kind: 'facts', id: f.id })}>恢复事实 {f.id}</button></p>)}
        <details><summary>查看所有保留版本（只读）</summary>{p.facts.map(f => <details key={refKey(f)}><summary>{refKey(f)} {f.statementZh}</summary><pre>{JSON.stringify(f, null, 2)}</pre></details>)}<h3>研究假设、障碍、分析与信息历史</h3><pre>{JSON.stringify({hypotheses:p.hypotheses,barriers:p.barriers,insights:p.insights,messages:p.messages,decisions:p.decisions}, null, 2)}</pre><h3>任务历史</h3><pre>{JSON.stringify(p.missionHistory, null, 2)}</pre><h3>语义核查记录</h3><pre>{JSON.stringify(p.meaningReviews, null, 2)}</pre></details></section>}
      <footer><strong>资料支持 ≠ 完整可购买</strong><p>原8条事实与7条来源的种子文件保持不变。新增/编辑内容由操作者负责核查；AI自动测试不是用户研究或你的个人核查。</p><span>LaunchProof · Evidence-Based Hardware GTM Decision Studio</span></footer>
    </main>
    {editor && <EvidenceEditor project={p} {...editor} onClose={() => setEditor(null)} onSave={async (draft, reason) => { const next = saveEntity(p, editor.kind, draft, editor.creating ? null : editor.item.revision, context(reason)); if (await w.commit(next)) setEditor(null); else throw new Error('保存暂停：请先处理其他标签页冲突；表单内容仍保留。'); }} />}
    {missionEdit && <MissionEditor project={missionEdit === 'new' ? seedProject() : p} creating={missionEdit === 'new'} onClose={() => setMissionEdit(null)} onSave={async (draft: Mission, reason) => {
      if (missionEdit === 'new') { const base = seedProject(); base.projectId = 'LP-' + crypto.randomUUID(); const next = editMission(base, draft, base.mission.revision, context(reason)); setReplacement({ project: next, label: '新建研究任务并替换当前项目' }); setMissionEdit(null); }
      else if (await w.commit(editMission(p, draft, p.mission.revision, context(reason)))) setMissionEdit(null); else throw new Error('保存暂停：请先处理其他标签页冲突；表单内容仍保留。');
    }} />}
    {drawer && <EditorDialog title="证据抽屉" onClose={() => setDrawer(null)}><p>引用版本：{refKey(drawer)}；当前查看不等于完成复核。</p><FactInspector fact={drawer} project={p} /></EditorDialog>}
    {review && <ActionDialog title="记录语义核查" action="确认记录核查" onClose={() => setReview(null)} onConfirm={async reason => { if (await w.commit(recordMeaningReview(p, review.id, context(reason)))) setReview(null); }}><p>记录归属：{author === 'self' ? '本人亲自操作' : 'AI辅助操作（不计本人核查）'}。只记录实际完成的核对；不能把缺来源、冲突或历史事实变成有效卖点。</p></ActionDialog>}
    {archive && <ActionDialog title="归档或恢复记录" action="确认归档或恢复" onClose={() => setArchive(null)} onConfirm={async reason => { if (await w.commit(archiveEntity(p, archive.kind, archive.id, context(reason)))) setArchive(null); }}><p>{archive.id}：保留所有历史版本；已被引用的来源不得删除或归档，失联可在编辑中记录。</p></ActionDialog>}
    {importOpen && !replacement && <EditorDialog title="导入JSON备份" onClose={() => setImportOpen(false)} dirty={!!importText}>
      <p>先隔离校验，再预览，最后确认替换；错误内容不会改变当前项目。</p>
      <label>选择JSON文件<input type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; if (file) try { setReplacement({ project: await readImportFile(file), label: '导入文件：' + file.name }); setImportError(''); } catch (err) { setImportError(String(err)); } e.target.value = ''; }} /></label>
      <label>或粘贴JSON<textarea value={importText} onChange={e => setImportText(e.target.value)} /></label><button onClick={() => { try { setReplacement({ project: previewImport(importText), label: '导入粘贴的JSON' }); setImportError(''); } catch (err) { setImportError(String(err)); } }}>校验并预览</button>
      {importError && <p role="alert" className="error">{importError}</p>}
    </EditorDialog>}
    {replacement && <EditorDialog title="确认替换预览" onClose={() => setReplacement(null)}><h3>{replacement.label}</h3><p>当前：{p.mission.question} · {currentFacts(p).length}条事实 / {latest(p.sources).length}条来源 / {latest(p.hypotheses).length}条假设 / {latest(p.messages).length}套方案 / {latest(p.decisions).length}条决定</p><p>候选：{replacement.project.mission.question} · {currentFacts(replacement.project).length}条事实 / {latest(replacement.project.sources).length}条来源 / {latest(replacement.project.hypotheses).length}条假设 / {latest(replacement.project.messages).length}套方案 / {latest(replacement.project.decisions).length}条决定</p><p className="warning">整个项目将替换，不合并。当前内存副本先保留为最近备份；最近备份会随后续保存更新，请先导出需长期保留的工作。导入的语义核查仅作历史，不自动视为本次本人已核查。</p><button onClick={exported}>先导出当前副本</button><form onSubmit={e => { e.preventDefault(); void replace(); }}><label className="checkline"><input required type="checkbox" />我理解替换范围，并保留当前副本</label><p role="status">{w.notice}</p><button disabled={locked} className="primary">确认替换并保存</button><button type="button" onClick={() => setReplacement(null)}>取消替换</button></form></EditorDialog>}
    {reloadConfirm && <EditorDialog title="重新载入本地版本" onClose={() => setReloadConfirm(false)}><p className="warning">当前内存可能有未保存修改。先导出副本后再载入；另一标签页的项目不会被覆盖。</p><button onClick={exported}>先导出当前副本</button><form onSubmit={e => { e.preventDefault(); w.reload(); setReloadConfirm(false); }}><label className="checkline"><input required type="checkbox" />已保留所需副本，允许替换当前内存</label><button>确认重新载入</button></form></EditorDialog>}
  </>;
}
function ActionDialog({ title, action, children, onClose, onConfirm }: { title: string; action: string; children: ReactNode; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <EditorDialog title={title} onClose={onClose} dirty={!!reason}>{children}<form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onConfirm(reason); } catch (err) { setError(String(err)); } finally { setBusy(false); } }}><label>操作理由<textarea required value={reason} onChange={e => setReason(e.target.value)} /></label><label className="checkline"><input type="checkbox" required />已理解记录范围与历史保留方式</label>{error && <p role="alert" className="error">{error}</p>}<button disabled={busy} className="primary">{action}</button></form></EditorDialog>;
}

