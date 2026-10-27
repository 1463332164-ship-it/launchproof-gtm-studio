import type { Fact, Project } from '../domain/entities';
import { refKey } from '../domain/validation';
import { assessEvidence } from '../domain/evidence';

export const labels = {
  supported: '资料支持', partial: '部分支持', contested: '存在冲突', unsupported: '缺少支持',
  in_scope: '适用当前型号', unresolved: '适用待核', out_of_scope: '超出型号范围',
  current: '快照核对有效', stale: '历史 / 待更新', unknown: '时效未知',
};

export function FactInspector({ fact, project }: { fact: Fact; project: Project }) {
  const product = project.products.find(p => refKey(p) === refKey(fact.subjectRef));
  const assessment = assessEvidence(fact, project);
  return <article className="inspector" aria-labelledby="fact-heading">
    <div className="eyebrow">事实记录 · {fact.id} / v{fact.revision}</div>
    <h2 id="fact-heading">{fact.statementZh}</h2>
    <p className="english" lang="en">{fact.statementEn}</p>
    <div className="badges">
      <span className="badge">{labels[assessment.supportStatus]}</span>
      <span className={`badge ${assessment.applicability !== 'in_scope' ? 'amber' : ''}`}>{labels[assessment.applicability]}</span>
      <span className={`badge ${assessment.freshness !== 'current' ? 'amber' : ''}`}>{labels[assessment.freshness]}</span>
    </div>
    <section className="review-state"><strong>{assessment.eligibleForClaim ? '本人核查已记录，仍需保留限定语' : '待复核 / 暂不可用于当前事实型卖点'}</strong><ul>{assessment.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></section>
    <dl className="scope-grid">
      <div><dt>研究对象</dt><dd>{product?.brand} {product?.modelName}<br />{product?.variant}</dd></div>
      <div><dt>原始主张范围</dt><dd>{fact.claimScope}</dd></div>
    </dl>
    <section className="limit-box"><h3>使用这条事实前，保留这些条件</h3>
      <ul>{fact.conditions.map(condition => <li key={condition}>{condition}</li>)}</ul>
    </section>
    <h3 className="source-heading">从结论回到来源</h3>
    {fact.evidenceLinks.map(link => {
      const source = project.sources.find(s => refKey(s) === refKey(link.sourceRef));
      if (!source) return <p role="alert" key={refKey(link.sourceRef)}>来源不存在，停止使用。</p>;
      return <section className="source-card" key={refKey(source)}>
        <div className="eyebrow">{source.id}@{source.revision} · {source.publisher} · {source.market} · {link.relation}</div>
        <h4>{source.title}</h4>
        <p>{source.summary}</p>
        <dl><dt>页面定位</dt><dd>{link.locator}</dd><dt>资料访问记录</dt><dd>{source.accessedAt}（保留原记录精度）</dd></dl>
        <p className="muted">{source.limitation}</p>
        <a href={source.url} target="_blank" rel="noreferrer">查看官方原始资料 <span aria-hidden="true">↗</span></a>
      </section>;
    })}
    <p className="footnote">这是资料核对入口，不是购买推荐。状态对应{project.mission.asOfDate}研究快照，不会自动证明今天仍然适用。</p>
  </article>;
}
