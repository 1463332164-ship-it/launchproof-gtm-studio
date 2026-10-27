import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function EditorDialog({ title, onClose, children, dirty = false }: { title: string; onClose: () => void; children: ReactNode; dirty?: boolean }) {
  const element = useRef<HTMLDialogElement>(null);
  const [discard, setDiscard] = useState(false);
  useEffect(() => { const dialog = element.current!; dialog.showModal(); return () => dialog.close(); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const close = () => dirty ? setDiscard(true) : onClose();
  return <dialog ref={element} className="editor-dialog" aria-label={title} onCancel={e => { e.preventDefault(); close(); }}>
    <div className="dialog-heading"><h2>{title}</h2><button type="button" onClick={close}>关闭</button></div>
    {discard ? <section className="warning" role="alert"><p>表单有未提交内容。放弃后不会改变项目。</p><button onClick={() => setDiscard(false)}>继续编辑</button><button onClick={onClose}>放弃表单并关闭</button></section> : children}
  </dialog>;
}
