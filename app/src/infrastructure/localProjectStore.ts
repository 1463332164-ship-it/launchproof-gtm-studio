import type { Project } from '../domain/entities';
import { previewImport, serializeProject } from './importExport';

export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export type LockPort = <T>(name: string, action: () => Promise<T>) => Promise<T>;
export type LoadResult = { status: 'empty' | 'valid' | 'invalid' | 'unavailable'; token: string | null; project?: Project; error?: string };
export class ConflictError extends Error {}

/** Storage and locks are injected so quota/blocked storage and racing writers can be tested. */
export class LocalProjectStore {
  readonly main: string; readonly backup: string; readonly recovery: string; readonly lockName: string;
  constructor(private storage: () => StoragePort, private lock: LockPort, namespace = 'launchproof') {
    this.main = `${namespace}.project.v1`; this.backup = `${namespace}.backup.v1`;
    this.recovery = `${namespace}.recovery.v1`; this.lockName = `${namespace}.write`;
  }
  load(): LoadResult {
    let token: string | null;
    try { token = this.storage().getItem(this.main); }
    catch { return { status: 'unavailable', token: null, error: '浏览器禁止读取本地存储；可在内存工作并导出JSON。' }; }
    if (token === null) return { status: 'empty', token };
    try { return { status: 'valid', token, project: previewImport(token) }; }
    catch (e) { return { status: 'invalid', token, error: `本地数据校验失败，原数据未覆盖。${String(e)}` }; }
  }
  readBackup(): Project {
    const raw = this.storage().getItem(this.backup);
    if (!raw) throw new Error('尚无最近有效备份；可选择已导出的JSON');
    return previewImport(raw);
  }
  async save(project: Project, expectedToken: string | null, memoryBefore?: Project, allowInvalidReplacement = false): Promise<string> {
    const json = serializeProject(project);
    return this.lock(this.lockName, async () => {
      const storage = this.storage(); const actual = storage.getItem(this.main);
      if (actual !== expectedToken) throw new ConflictError('其他标签页已更新或清空项目；已停止覆盖，请先导出当前副本再重新载入。');
      let validBefore: string | null = null;
      if (actual !== null) {
        try { previewImport(actual); validBefore = actual; }
        catch {
          if (!allowInvalidReplacement) throw new Error('当前存储损坏；请通过导入预览明确确认恢复，不能直接覆盖');
          storage.setItem(this.recovery, actual); // Preserve malformed original before any replacement.
        }
      }
      const prior = memoryBefore ? serializeProject(memoryBefore) : validBefore;
      if (prior !== null) storage.setItem(this.backup, prior);
      // setItem is atomic for one key: failure leaves the prior main snapshot intact.
      storage.setItem(this.main, json);
      return json;
    });
  }
}

export function browserStore(namespace?: string): LocalProjectStore {
  return new LocalProjectStore(() => window.localStorage, async (name, action) => {
    if (!navigator.locks) throw new Error('此浏览器不支持安全的多标签写入锁；请使用现代Edge/Chrome，当前数据仍可导出。');
    return navigator.locks.request(name, { mode: 'exclusive' }, action);
  }, namespace);
}
