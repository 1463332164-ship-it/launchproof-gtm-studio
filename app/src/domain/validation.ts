import { PRODUCT_IDS, projectSchema } from './schema';
import type { Fact, Project, Quantity, Ref, ValidationIssue, ValidationResult, VersionedEntity } from './entities';
import { latest, refKey } from './refs';
export { latest, refKey } from './refs';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_CURRENT_ENTITIES = 200;
/** Validate the LP01 data contract. This is not semantic fact certification. */
export function validateProject(input: unknown): ValidationResult {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issue => ({
    path: issue.path.join('.') || '$', code: issue.code, message: issue.message,
  })) };
  const p = parsed.data;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const fail = (path: string, code: string, message: string) => errors.push({ path, code, message });
  const groups = { mission: [...p.missionHistory, p.mission], products: p.products, sources: p.sources, facts: p.facts,
    hypotheses:p.hypotheses, barriers:p.barriers, insights:p.insights, messages:p.messages, decisions:p.decisions };
  const registry = new Map<string, { kind: string; entity: VersionedEntity }>();
  const idKinds = new Map<string, string>();
  const byId = new Map<string, VersionedEntity[]>();
  for (const [kind, entities] of Object.entries(groups)) {
    for (const [index, entity] of entities.entries()) {
      const path = `${kind}.${index}`;
      const key = refKey(entity);
      if (registry.has(key)) fail(path, 'duplicate_version', 'ID与版本号重复');
      if (idKinds.has(entity.id) && idKinds.get(entity.id) !== kind) fail(path, 'id_kind_collision', '同一ID不可用于不同实体类型');
      registry.set(key, { kind, entity }); idKinds.set(entity.id, kind);
      byId.set(entity.id, [...(byId.get(entity.id) ?? []), entity]);
      if (Date.parse(entity.updatedAt) < Date.parse(entity.createdAt)) fail(path, 'invalid_chronology', '更新时间早于创建时间');
    }
  }
  if (byId.size > MAX_CURRENT_ENTITIES) fail('$', 'entity_limit', '当前实体超过200个');
  for (const [id, versions] of byId) {
    const sorted = [...versions].sort((a, b) => a.revision - b.revision);
    sorted.forEach((entity, i) => {
      if (entity.revision !== i + 1) fail(id, 'missing_revision', '版本必须从1连续保留');
    });
  }
  const resolve = (ref: Ref, kind: string, path: string) => {
    const target = registry.get(refKey(ref));
    if (!target) { fail(path, 'dangling_ref', `找不到${refKey(ref)}`); return undefined; }
    if (target.kind !== kind) { fail(path, 'wrong_ref_type', `引用必须指向${kind}`); return undefined; }
    return target.entity;
  };
  const currentProducts = latest(p.products);
  if (currentProducts.length !== 2) fail('products', 'product_count', 'LP01限定两款精确型号');
  const exactModels: Record<string, readonly string[]> = {
    [PRODUCT_IDS[0]]: ['SwitchBot', 'Curtain 3', 'Rod Type 1'],
    [PRODUCT_IDS[1]]: ['Aqara', 'Curtain Driver E1', 'Rod Version'],
  };
  for (const [i, product] of p.products.entries()) {
    const expected = exactModels[product.id];
    if (!expected || [product.brand, product.modelName, product.variant].some((v, j) => v !== expected[j]))
      fail(`products.${i}`, 'model_mismatch', '产品ID与品牌/型号/版本不一致');
    product.sourceRefs.forEach((ref, j) => resolve(ref, 'sources', `products.${i}.sourceRefs.${j}`));
  }
  const mission = p.mission;
  if (p.missionHistory.some(m => m.id !== mission.id || m.revision >= mission.revision))
    fail('missionHistory', 'invalid_mission_history', '任务历史必须为同ID较早版本');
  for (const [index, snapshot] of [...p.missionHistory, mission].entries()) {
    const path = index < p.missionHistory.length ? `missionHistory.${index}` : 'mission';
    const missionRefs = [snapshot.focalProductRef, ...snapshot.competitorRefs];
    if (new Set(missionRefs.map(ref => ref.id)).size !== 2) fail(path, 'duplicate_product', '定位对象与竞品必须不同');
    missionRefs.forEach((ref, i) => {
      const target = resolve(ref, 'products', `${path}.productRefs.${i}`);
      if (target?.archived && snapshot.state === 'active') fail(path, 'archived_product', '活动任务不能引用已归档产品');
    });
  }
  const firstMission = [...p.missionHistory, mission].reduce((a, b) => a.revision < b.revision ? a : b);
  for (const [i, fact] of p.facts.entries()) {
    const path = `facts.${i}`;
    resolve(fact.subjectRef, 'products', `${path}.subjectRef`);
    if (fact.applicability === 'in_scope' && fact.claimScope !== fact.subjectRef.id)
      fail(path, 'scope_mismatch', '家族/其他版本的资料不能标为精确型号适用');
    if (fact.value === null && !fact.missingReason) fail(`${path}.missingReason`, 'unknown_reason', '未知值必须说明原因');
    if (fact.value !== null && fact.missingReason !== null) fail(path, 'unexpected_missing_reason', '已知值的缺失原因应为null');
    if (typeof fact.value === 'object' && fact.value !== null) {
      if ('min' in fact.value) {
        if (fact.value.min > fact.value.max || (fact.value.min === fact.value.max && (!fact.value.inclusiveMin || !fact.value.inclusiveMax)))
          fail(`${path}.value`, 'invalid_range', '范围必须非空且下界不大于上界');
      } else {
        validateQuantity(fact.value, `${path}.value`, fail);
        fact.value.sourceRefs.forEach((ref, j) => resolve(ref, 'sources', `${path}.value.sourceRefs.${j}`));
        if (fact.value.assumptionId !== null)
          fail(`${path}.value.assumptionId`, 'unsupported_milestone', 'LP01尚未接受假设实体，不能接受未解析的假设引用');
      }
    }
    const supports = fact.evidenceLinks.filter(link => link.relation === 'supports');
    const contradicts = fact.evidenceLinks.some(link => {
      const source = p.sources.find(s => refKey(s) === refKey(link.sourceRef));
      return link.relation === 'contradicts' && source?.productScope.includes(fact.claimScope) &&
        (source.market === mission.market || (fact.claimScope.endsWith('FAMILY') && source.market === 'GLOBAL'));
    });
    if (['supported', 'partial'].includes(fact.supportStatus) && supports.length === 0)
      fail(path, 'missing_support', '已支持/部分支持至少需要一条支持来源');
    if (fact.supportStatus === 'supported' && (contradicts || fact.conflictGroupId !== null))
      fail(path, 'unresolved_conflict', '未解决反证不能标为已支持');
    if (fact.supportStatus === 'contested' && (!contradicts || !fact.conflictGroupId))
      fail(path, 'missing_conflict', '冲突状态需反证和冲突组');
    for (const [j, link] of fact.evidenceLinks.entries()) {
      resolve(link.sourceRef, 'sources', `${path}.evidenceLinks.${j}`);
      const source = p.sources.find(s => refKey(s) === refKey(link.sourceRef));
      if (source && link.relation === 'supports' && fact.applicability === 'in_scope') {
        if (!source.productScope.includes(fact.claimScope) || source.market !== mission.market)
          fail(path, 'source_scope_mismatch', '来源的型号和地区不能自动映射到任务');
      }
    }
    if (fact.freshness === 'current') {
      if (!fact.reviewedAt) fail(path, 'missing_review_date', '现行状态需要实质核查日期');
      // Stored historical facts are checked against their original assessment snapshot.
      // Current usefulness is derived separately by assessEvidence, never by rewriting history.
      const snapshotDate = fact.assessmentDate ?? firstMission.asOfDate;
      const age = fact.reviewedAt ? (Date.parse(`${snapshotDate}T23:59:59Z`) - Date.parse(fact.reviewedAt)) / 86400000 : Infinity;
      if (age < 0) fail(path, 'future_review', '核查时间晚于任务评估日');
      const viable = supports.some(link => {
        const s = p.sources.find(source => refKey(source) === refKey(link.sourceRef));
        return s && !s.archived && s.accessStatus === 'body_read' && s.reviewIntervalDays !== null && Math.floor(age) <= s.reviewIntervalDays;
      });
      if (!viable) fail(path, 'freshness_not_supported', '无可读取且在复核周期内的支持来源，不能标现行');
    }
    if (fact.supersedesRef) {
      const prior = resolve(fact.supersedesRef, 'facts', `${path}.supersedesRef`);
      if (prior && (prior.id !== fact.id || prior.revision >= fact.revision))
        fail(path, 'invalid_predecessor', '替代引用须指向同ID的较早版本，不能形成循环');
    }
    if (fact.applicability !== 'in_scope' || fact.freshness !== 'current' || fact.supportStatus !== 'supported')
      warnings.push({ path, code: 'limited_evidence', message: `${fact.id}保留适用/时效/支持限制，不是校验失败` });
  }
  const resolveKinds = (ref: Ref, kinds: string[], path: string) => {
    const kind = registry.get(refKey(ref))?.kind;
    if (!kind || !kinds.includes(kind)) fail(path,'invalid_reference','引用缺失或类型不符：' + refKey(ref));
  };
  for (const h of p.hypotheses) {
    h.basisRefs.forEach(r => resolveKinds(r,['facts','sources'],h.id+'.basisRefs'));
    if (h.actualSampleSize !== 0 || h.observationRefs.length || !['untested','in_progress'].includes(h.researchStatus))
      fail(h.id,'unverified_research','LP03没有已获同意的研究记录模块；不得填写实际样本或样本支持结论');
  }
  for (const b of p.barriers) {
    resolve(b.hypothesisRef,'hypotheses',b.id+'.hypothesisRef');
    for (const k of ['impact','relevance','actionability'] as const) if (b[k] !== null && !b.scoreRationale[k].trim())
      fail(b.id+'.scoreRationale.'+k,'missing_rationale','每个已填写评分都需要独立理由');
  }
  for (const i of p.insights) {
    i.premiseRefs.forEach(r=>resolveKinds(r,['facts','hypotheses'],i.id+'.premiseRefs'));
    i.counterEvidenceRefs.forEach(r=>resolveKinds(r,['facts','sources'],i.id+'.counterEvidenceRefs'));
  }
  for (const m of p.messages) {
    resolve(m.missionRef,'mission',m.id+'.missionRef');
    resolve(m.segmentHypothesisRef,'hypotheses',m.id+'.segmentHypothesisRef');
    m.barrierRefs.forEach(r=>resolve(r,'barriers',m.id+'.barrierRefs'));
    const claimIds = new Set<string>();
    for (const claim of m.claimItems) {
      if (claimIds.has(claim.id)) fail(m.id,'duplicate_claim','同一信息方案的主张ID不能重复');
      claimIds.add(claim.id);
      claim.basisRefs.forEach(r=>resolveKinds(r,claim.kind==='fact'?['facts']:claim.kind==='hypothesis'?['hypotheses']:['facts','hypotheses','insights'],m.id+'.'+claim.id));
      if (claim.comparisonScope) {
        claim.comparisonScope.productRefs.forEach(r=>resolve(r,'products',m.id+'.comparisonScope'));
        if (new Set(claim.comparisonScope.productRefs.map(r=>r.id)).size!==2) fail(m.id,'comparison_products','对比主张需要两款不同产品');
      }
    }
    if (m.reviewState==='ready_with_limits' && (!m.humanReview || m.humanReview.authorType!=='self' || m.humanReview.imported || !m.inputFingerprint || !m.claimItems.every(c=>c.humanMeaningReview)))
      fail(m.id,'missing_author_review','已复核信息需本人的语义核查与输入指纹；导入历史不能冒充当前核查');
  }
  for (const d of p.decisions) {
    resolve(d.missionRef,'mission',d.id+'.missionRef');
    const ids=d.options.map(o=>o.id);
    if(new Set(ids).size!==ids.length) fail(d.id,'duplicate_option','候选ID重复');
    if(d.selectedOptionId!==null&&!ids.includes(d.selectedOptionId)) fail(d.id,'selected_option','所选候选不存在');
    for(const o of d.options) {
      o.messageRefs.forEach(r=>resolve(r,'messages',d.id+'.options'));
      if(o.kind==='defer'&&o.messageRefs.length) fail(d.id,'defer_message','暂缓选项不绑定采用消息');
    }
    [...d.supportingRefs,...d.counterRefs].forEach(r=>resolveKinds(r,['facts','sources','hypotheses','barriers','insights','messages'],d.id+'.evidence'));
    if(d.previousDecisionRef) {
      resolve(d.previousDecisionRef,'decisions',d.id+'.previousDecisionRef');
      if(d.previousDecisionRef.id!==d.id||d.previousDecisionRef.revision!==d.revision-1) fail(d.id,'invalid_predecessor','决定必须链接同ID上一版本');
    }
    if(d.revision>1&&(!d.previousDecisionRef||!d.changeReason?.trim())) fail(d.id,'decision_history','新版决定需前版引用与变更理由');
    if(d.state==='recorded' && (d.options.length<2||!d.selectedOptionId||!d.rationale.trim()||!d.tradeoffs.length||!d.revisitTriggers.length||!d.owner.trim()||!d.nextSteps.length||(!d.counterRefs.length&&!d.counterSearchNote.trim())||!d.decidedAt||!d.inputFingerprint))
      fail(d.id,'incomplete_decision','已记录决定需两候选、选择、取舍、反证说明、复核触发、责任与下一步');
    if(d.state==='recorded'&&d.purpose==='external_message'&&(!d.personalReview||d.personalReview.imported)) fail(d.id,'personal_decision','对外方案需要本人当前确认');
  }
  const eventIds = new Set<string>();
  for (const event of p.changeEvents) {
    if (eventIds.has(event.id) || idKinds.has(event.id)) fail('changeEvents', 'duplicate_event', '变更记录ID重复');
    eventIds.add(event.id);
    for (const ref of [event.entityRefBefore, event.entityRefAfter, ...event.affectedRefs]) {
      if (ref && !registry.has(refKey(ref))) fail('changeEvents', 'dangling_ref', '变更记录引用缺失');
    }
    if (event.entityRefBefore && (event.entityRefBefore.id !== event.entityRefAfter.id || event.entityRefAfter.revision !== event.entityRefBefore.revision + 1))
      fail('changeEvents', 'invalid_event_revision', '变更前后版本必须连续');
  }
  for (const review of p.meaningReviews) {
    resolve(review.factRef, 'facts', 'meaningReviews.factRef');
    resolve(review.missionRef, 'mission', 'meaningReviews.missionRef');
    review.sourceRefs.forEach(ref => resolve(ref, 'sources', 'meaningReviews.sourceRefs'));
  }
  return errors.length ? { ok: false, errors } : { ok: true, data: p, warnings };
}

function validateQuantity(q: Quantity, path: string, fail: (path: string, code: string, message: string) => void) {
  if (q.value === null && !q.missingReason) fail(path, 'unknown_reason', '未知数量必须有原因');
  if (q.value !== null && q.missingReason !== null) fail(path, 'unexpected_missing_reason', '已知数量的缺失原因应为null');
  if (['simulated', 'design_assumption', 'derived'].includes(q.origin) && q.assumptionId === null)
    fail(path, 'missing_assumption', '模拟/设计/派生参数必须记录假设依据');
  if (q.origin === 'official' && q.sourceRefs.length === 0) fail(path, 'missing_source', '官方数量必须有来源');
}

/** Parse bytes before any future persistence operation. Does not write localStorage. */
export function validateProjectJson(json: string): ValidationResult {
  if (new TextEncoder().encode(json).byteLength > MAX_IMPORT_BYTES)
    return { ok: false, errors: [{ path: '$', code: 'size_limit', message: '文件超过2MiB，未读取为项目' }] };
  let input: unknown;
  try { input = JSON.parse(json); }
  catch { return { ok: false, errors: [{ path: '$', code: 'invalid_json', message: 'JSON格式无效' }] }; }
  return validateProject(input);
}

export function currentFacts(project: Project): Fact[] { return latest(project.facts).filter(fact => !fact.archived); }
