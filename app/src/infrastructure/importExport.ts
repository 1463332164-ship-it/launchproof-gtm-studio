import type { Project } from '../domain/entities';
import { MAX_IMPORT_BYTES, validateProjectJson } from '../domain/validation';

export function serializeProject(project: Project): string {
  const pretty = JSON.stringify(project, null, 2);
  // Formatting whitespace must not make an otherwise valid near-limit backup unrestorable.
  const json = new TextEncoder().encode(pretty).byteLength <= MAX_IMPORT_BYTES ? pretty : JSON.stringify(project);
  const result = validateProjectJson(json);
  if (!result.ok) throw new Error(result.errors.map(e => `${e.path}: ${e.message}`).join('\n'));
  return json;
}
export function previewImport(json: string): Project {
  if(new TextEncoder().encode(json).byteLength>MAX_IMPORT_BYTES)throw new Error('文件超过2MiB');
  let candidate:unknown;try{candidate=JSON.parse(json);}catch{throw new Error('JSON格式无效');}
  if(candidate&&typeof candidate==='object'&&'format' in candidate){
    const envelope=candidate as {format:unknown;project?:unknown;snapshot?:unknown};
    if(envelope.format!=='launchproof-brief/1'||!envelope.project||!envelope.snapshot)throw new Error('不支持的简报快照格式');
    candidate=envelope.project; // Reports are never trusted as current approval; restore only the validated project.
  }
  const result = validateProjectJson(JSON.stringify(candidate));
  if (!result.ok) throw new Error(result.errors.map(e => `${e.path}: ${e.message}`).join('\n'));
  return result.data;
}
export async function readImportFile(file: File): Promise<Project> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('文件超过2MiB，未读取/未覆盖');
  return previewImport(await file.text());
}
export function downloadText(text: string, filename: string, mime='application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime+';charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
