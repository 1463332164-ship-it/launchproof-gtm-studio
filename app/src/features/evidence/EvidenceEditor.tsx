import { useState } from 'react';
import type { Fact, Project, Source } from '../../domain/entities';
import { SCOPE_IDS } from '../../domain/schema';
import { latest } from '../../domain/validation';
import { EditorDialog } from '../../components/EditorDialog';

type Props = { project: Project; item: Fact | Source; kind: 'facts' | 'sources'; creating: boolean; onSave: (draft: Fact | Source, reason: string) => Promise<void>; onClose: () => void };
export function EvidenceEditor({ project, item, kind, creating, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(structuredClone(item)); const [reason, setReason] = useState('');
  const [jsonValue, setJsonValue] = useState('value' in item ? JSON.stringify(item.value, null, 2) : 'null');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const set = (key: string, value: unknown) => setDraft({ ...draft, [key]: value });
  const f = draft as Fact; const s = draft as Source;
  return <EditorDialog title={`${creating ? '新增' : '编辑'}${kind === 'facts' ? '事实' : '来源'}`} onClose={onClose} dirty={JSON.stringify(draft) !== JSON.stringify(item) || !!reason || ('value' in item && jsonValue !== JSON.stringify(item.value, null, 2))}>
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); try { const value = kind === 'facts' ? { ...f, value: JSON.parse(jsonValue) as unknown } : s; await onSave(value as Fact | Source, reason); } catch (err) { setError(String(err)); } finally { setBusy(false); } }}>
      <p>保存会新增版本。不会覆盖历史，不能把未核查资料写成本人已验证。</p>
      <label>记录ID<input required disabled={!creating} value={draft.id} onChange={e => set('id', e.target.value)} /></label>
      {kind === 'facts' ? <>
        <label>中文窄事实<textarea required value={f.statementZh} onChange={e => set('statementZh', e.target.value)} /></label>
        <label>英文表述（未知可留空）<textarea value={f.statementEn ?? ''} onChange={e => set('statementEn', e.target.value || null)} /></label>
        <label>维度标识<input required value={f.predicate} onChange={e => set('predicate', e.target.value)} /></label>
        <div className="form-grid"><label>研究型号<select value={f.subjectRef.id} onChange={e => set('subjectRef', { id: e.target.value, revision: 1 })}>{project.products.map(p => <option key={p.id} value={p.id}>{p.brand} {p.variant}</option>)}</select></label>
          <label>原始主张范围<select value={f.claimScope} onChange={e => set('claimScope', e.target.value)}>{SCOPE_IDS.map(id => <option key={id}>{id}</option>)}</select></label></div>
        <label>适用条件（每行一条）<textarea required value={f.conditions.join('\n')} onChange={e => set('conditions', e.target.value.split('\n'))} /></label>
        <details><summary>原始值与单位（结构化JSON，未知为null）</summary><label>事实原始值<textarea value={jsonValue} onChange={e => setJsonValue(e.target.value)} /></label><p>保留原值及单位；false为明确排除，null为未知。</p></details>
        <label>未知原因（仅原始值为null时填写）<input value={f.missingReason ?? ''} onChange={e => set('missingReason', e.target.value || null)} /></label>
        <fieldset><legend>证据引用与反证</legend>{f.evidenceLinks.map((link, i) => <div className="evidence-row" key={i}>
          <label>来源与版本 {i + 1}<select value={`${link.sourceRef.id}@${link.sourceRef.revision}`} onChange={e => { const [id, revision] = e.target.value.split('@'); set('evidenceLinks', f.evidenceLinks.map((l, n) => n === i ? { ...l, sourceRef: { id, revision: Number(revision) } } : l)); }}>
            {project.sources.map(src => <option key={`${src.id}@${src.revision}`} value={`${src.id}@${src.revision}`}>{src.id}@{src.revision} {src.title}{src.archived ? '（已归档）' : ''}</option>)}</select></label>
          <label>关系 {i + 1}<select value={link.relation} onChange={e => set('evidenceLinks', f.evidenceLinks.map((l, n) => n === i ? { ...l, relation: e.target.value } : l))}><option value="supports">支持</option><option value="contradicts">反证（需同条件语义核对）</option><option value="context">背景</option></select></label>
          <label>来源定位 {i + 1}<input required value={link.locator} onChange={e => set('evidenceLinks', f.evidenceLinks.map((l, n) => n === i ? { ...l, locator: e.target.value } : l))} /></label>
          <label>适用说明 {i + 1}<input required value={link.applicabilityNote} onChange={e => set('evidenceLinks', f.evidenceLinks.map((l, n) => n === i ? { ...l, applicabilityNote: e.target.value } : l))} /></label>
          <button type="button" onClick={() => set('evidenceLinks', f.evidenceLinks.filter((_, n) => n !== i))}>移除引用 {i + 1}</button>
        </div>)}<button type="button" onClick={() => { const src = latest(project.sources).find(src => !src.archived); if (src) set('evidenceLinks', [...f.evidenceLinks, { sourceRef: { id: src.id, revision: src.revision }, relation: 'context', locator: src.locator, applicabilityNote: '待核对是否支持本表述' }]); }}>添加来源引用</button></fieldset>
        <div className="form-grid"><label>记录的支持判断<select value={f.supportStatus} onChange={e => set('supportStatus', e.target.value)}>{['unsupported','partial','supported','contested'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>记录的适用判断<select value={f.applicability} onChange={e => set('applicability', e.target.value)}>{['unresolved','in_scope','out_of_scope'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>记录的时效判断<select value={f.freshness} onChange={e => set('freshness', e.target.value)}>{['unknown','current','stale'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>实质核查日期<input type="date" value={f.reviewedAt?.slice(0, 10) ?? ''} onChange={e => set('reviewedAt', e.target.value || null)} /></label></div>
        <label>冲突组（无则留空）<input value={f.conflictGroupId ?? ''} onChange={e => set('conflictGroupId', e.target.value || null)} /></label>
        <label>核查说明<textarea required value={f.reviewNote} onChange={e => set('reviewNote', e.target.value)} /></label>
        <p>三个判断会经过规则检查；来源缺失/失联不能维持有效支持。完成本人语义核查另行记录，不由保存按钮代填。</p>
      </> : <>
        <label>来源标题<input required value={s.title} onChange={e => set('title', e.target.value)} /></label>
        <label>发布者<input required value={s.publisher} onChange={e => set('publisher', e.target.value)} /></label>
        <label>来源URL<input required value={s.url} onChange={e => set('url', e.target.value)} /></label>
        <label>来源类型<select value={s.sourceType} onChange={e => set('sourceType', e.target.value)}>{['official_product','official_support','official_announcement','repository','third_party','user_research','official_job'].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>页面定位<input required value={s.locator} onChange={e => set('locator', e.target.value)} /></label>
        <label>自写摘要<textarea required value={s.summary} onChange={e => set('summary', e.target.value)} /></label>
        <div className="form-grid"><label>来源地区<select value={s.market} onChange={e => set('market', e.target.value)}>{['US','GLOBAL','UNKNOWN'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>读取状态<select value={s.accessStatus} onChange={e => set('accessStatus', e.target.value)}><option value="body_read">已读正文</option><option value="index_only">仅索引</option><option value="inherited_unchecked">继承待核</option><option value="unavailable">失联/不可访问</option></select></label>
          <label>访问日期<input required type="date" value={s.accessedAt.slice(0, 10)} onChange={e => set('accessedAt', e.target.value)} /></label>
          <label>复核周期（天；未知留空）<input type="number" min="1" value={s.reviewIntervalDays ?? ''} onChange={e => set('reviewIntervalDays', e.target.value === '' ? null : Number(e.target.value))} /></label></div>
        <fieldset><legend>来源覆盖范围</legend>{SCOPE_IDS.map(id => <label className="checkline" key={id}><input type="checkbox" checked={s.productScope.includes(id)} onChange={e => set('productScope', e.target.checked ? [...s.productScope, id] : s.productScope.filter(v => v !== id))} />{id}</label>)}</fieldset>
        <label>使用限制<textarea required value={s.limitation} onChange={e => set('limitation', e.target.value)} /></label>
        <label>核查者及范围<input required value={s.checkedBy} onChange={e => set('checkedBy', e.target.value)} /></label>
        <p>访问日期更新不会自动修改事实的核查日期。原继承记录与未知发布日期保留。</p>
      </>}
      <label>修改理由<input required value={reason} onChange={e => setReason(e.target.value)} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button disabled={busy} className="primary">保存{kind === 'facts' ? '事实' : '来源'}新版本</button>
    </form>
  </EditorDialog>;
}

export function emptyFact(p: Project, now: string): Fact {
  return { id: '', revision: 1, createdAt: now, updatedAt: now, createdBy: 'ai_assisted', archived: false,
    statementZh: '', statementEn: null, subjectRef: p.mission.focalProductRef, claimScope: 'P-SB-C3-T1-US', predicate: '',
    value: null, missingReason: '待取得资料', conditions: ['适用条件待核'], evidenceLinks: [], supportStatus: 'unsupported',
    applicability: 'unresolved', freshness: 'unknown', conflictGroupId: null, supersedesRef: null, reviewNote: '尚未核查', reviewedAt: null };
}
export function emptySource(now: string): Source {
  return { id: '', revision: 1, createdAt: now, updatedAt: now, createdBy: 'ai_assisted', archived: false,
    title: '', publisher: '', url: '', sourceType: 'third_party', accessedAt: now, publishedAt: null, pageUpdatedAt: null,
    accessStatus: 'inherited_unchecked', locator: '', summary: '', shortQuote: null, market: 'UNKNOWN', productScope: [],
    reusePolicy: 'summary_link_only', limitation: '尚未完成核查，仅保存必要摘要和链接', checkedBy: '尚未核查', reviewIntervalDays: null, provenance: null };
}
