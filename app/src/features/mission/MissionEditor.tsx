import { useState } from 'react';
import type { Mission, Project } from '../../domain/entities';
import { EditorDialog } from '../../components/EditorDialog';

export function MissionEditor({ project, creating, onSave, onClose }: { project: Project; creating: boolean; onSave: (draft: Mission, reason: string) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState(structuredClone(project.mission));
  const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const set = <K extends keyof Mission>(key: K, value: Mission[K]) => setDraft({ ...draft, [key]: value });
  return <EditorDialog title={creating ? '新建研究任务' : '编辑研究任务'} onClose={onClose} dirty={JSON.stringify(draft) !== JSON.stringify(project.mission) || !!reason}>
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSave(draft, reason); } catch (err) { setError(String(err)); } finally { setBusy(false); } }}>
      <p>只研究两款精确型号。无效输入保留在此表单，不覆盖已保存项目。</p>
      <label>研究问题<textarea required maxLength={500} value={draft.question} onChange={e => set('question', e.target.value)} /></label>
      <div className="form-grid"><label>市场<input required value={draft.market} onChange={e => set('market', e.target.value as 'US')} /></label>
        <label>证据评估日期<input required type="date" value={draft.asOfDate} onChange={e => set('asOfDate', e.target.value)} /></label></div>
      <div className="form-grid"><label>定位对象<select value={draft.focalProductRef.id} onChange={e => set('focalProductRef', { id: e.target.value, revision: 1 })}>{project.products.map(p => <option key={p.id} value={p.id}>{p.brand} {p.variant}</option>)}</select></label>
        <label>比较对象<select value={draft.competitorRefs[0]!.id} onChange={e => set('competitorRefs', [{ id: e.target.value, revision: 1 }])}>{project.products.map(p => <option key={p.id} value={p.id}>{p.brand} {p.variant}</option>)}</select></label></div>
      <label>成功标准（每行一项）<textarea required value={draft.successCriteria.join('\n')} onChange={e => set('successCriteria', e.target.value.split('\n'))} /></label>
      <label>排除范围（每行一项）<textarea required value={draft.exclusions.join('\n')} onChange={e => set('exclusions', e.target.value.split('\n'))} /></label>
      <label>任务状态<select value={draft.state} onChange={e => set('state', e.target.value as Mission['state'])}><option value="draft">草稿</option><option value="active">进行中</option><option value="archived">归档</option></select></label>
      <label>修改理由<input required value={reason} onChange={e => setReason(e.target.value)} /></label>
      {creating && <p className="warning">下一步将预览替换当前项目。新任务使用原始8事实/7来源，不复制当前修改；当前项目先保留为恢复副本。</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <button className="primary" disabled={busy}>{creating ? '校验并预览新任务' : '保存任务新版本'}</button>
    </form>
  </EditorDialog>;
}
