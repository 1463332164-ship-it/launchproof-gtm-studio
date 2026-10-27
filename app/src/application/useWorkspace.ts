import { useEffect, useRef, useState } from 'react';
import { loadSeed } from './loadSeed';
import type { Project } from '../domain/entities';
import { browserStore, ConflictError } from '../infrastructure/localProjectStore';

import { workspaceScope } from '../infrastructure/workspaceScope';
export const scope = workspaceScope(window.location.search,import.meta.env.DEV);
export const testNamespace = scope.kind==='test'?scope.namespace:undefined;
export const practiceNamespace = scope.kind==='practice'?scope.namespace:undefined;
export const store = browserStore(scope.namespace);
export function seedProject(): Project {
  const result = loadSeed(); if (!result.ok) throw new Error('原始样例校验失败'); return result.data;
}

export function useWorkspace() {
  const [initial] = useState(() => store.load());
  const [project, setProject] = useState<Project>(() => initial.project ?? seedProject());
  const token = useRef(initial.token);
  const [dirty, setDirty] = useState(initial.status !== 'valid');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [invalid, setInvalid] = useState(initial.status === 'invalid');
  const [notice, setNotice] = useState(initial.error ?? (initial.status === 'valid' ? '已恢复本地项目' : '样例尚未保存；任何修改均在本地完成'));
  const inFlight = useRef(false);
  useEffect(() => {
    const changed = (e: StorageEvent) => {
      if ((e.key === store.main || e.key === null) && e.newValue !== token.current) {
        setConflict(true); setNotice('其他标签页已更新项目：当前副本保留，暂停保存。可先导出，再重新载入。');
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function commit(next: Project, replacement = false): Promise<boolean> {
    if (inFlight.current || conflict) { setNotice('保存已暂停：存在另一标签页修改或正在写入'); return false; }
    if (invalid && !replacement) { setNotice('原本地文件校验失败；请用备份/导入预览明确恢复，原文件不会自动覆盖'); return false; }
    inFlight.current = true; setBusy(true);
    if (!replacement) { setProject(next); setDirty(true); }
    try {
      const saved = await store.save(next, token.current, replacement ? project : undefined, replacement);
      token.current = saved; setProject(next); setDirty(false); setInvalid(false); setNotice('已保存到本地；最近有效副本已保留'); return true;
    } catch (e) {
      if (e instanceof ConflictError) setConflict(true);
      setNotice(`保存失败：${e instanceof Error ? e.message : String(e)}。当前内存可导出JSON。`);
      // Ordinary edits remain in memory; replacements remain uncommitted on failure.
      return !replacement;
    } finally { inFlight.current = false; setBusy(false); }
  }
  function reload() {
    const loaded = store.load();
    if (loaded.status !== 'valid' || !loaded.project) { setNotice(loaded.error ?? '本地没有可恢复项目；当前内存保留'); return; }
    token.current = loaded.token; setProject(loaded.project); setConflict(false); setInvalid(false); setDirty(false); setNotice('已重新载入另一标签页的有效版本');
  }
  return { project, commit, busy, dirty, conflict, invalid, notice, setNotice, reload };
}
