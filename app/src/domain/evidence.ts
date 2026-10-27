import type { Fact, Project, Source } from './entities';
import { latest, refKey } from './validation';

export interface EvidenceAssessment {
  supportStatus: Fact['supportStatus']; applicability: Fact['applicability']; freshness: Fact['freshness'];
  needsReview: boolean; eligibleForClaim: boolean; reasons: string[];
}
const logDay = (date: string) => date.length === 10 ? date : new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(date));

export function assessEvidence(fact: Fact, p: Project): EvidenceAssessment {
  const reasons: string[] = [];
  const currentSources = latest(p.sources);
  const lookup = (id: string) => currentSources.find(s => s.id === id);
  const readable = (s: Source | undefined): s is Source => !!s && !s.archived && s.accessStatus === 'body_read';
  const sameScope = (s: Source) => s.productScope.includes(fact.claimScope) &&
    (s.market === p.mission.market || (fact.claimScope.endsWith('FAMILY') && s.market === 'GLOBAL'));
  const supports = fact.evidenceLinks.filter(l => l.relation === 'supports' && readable(lookup(l.sourceRef.id)) && sameScope(lookup(l.sourceRef.id)!));
  const contrary = fact.evidenceLinks.some(l => l.relation === 'contradicts' && readable(lookup(l.sourceRef.id)) && sameScope(lookup(l.sourceRef.id)!));
  const changedSource = fact.evidenceLinks.some(l => lookup(l.sourceRef.id)?.revision !== l.sourceRef.revision);
  let supportStatus: Fact['supportStatus'] = supports.length ? fact.supportStatus : 'unsupported';
  if (contrary || fact.conflictGroupId) { supportStatus = 'contested'; reasons.push('同范围反证或未解决冲突需保留双方；不自动选择较新来源。'); }
  if (!supports.length) reasons.push('没有正文可读且范围匹配的支持资料；URL存在不等于支持。');
  if (fact.evidenceLinks.some(l => l.relation === 'contradicts' && lookup(l.sourceRef.id) && !sameScope(lookup(l.sourceRef.id)!))) reasons.push('另有不同型号/地区的反证记录：先作为范围差异，不自动制造同范围冲突。');
  let applicability = fact.applicability;
  if (fact.claimScope !== fact.subjectRef.id && applicability === 'in_scope') applicability = 'unresolved';
  if (applicability === 'in_scope' && !supports.some(l => lookup(l.sourceRef.id)?.market === 'US')) applicability = 'unresolved';
  let freshness: Fact['freshness'] = fact.freshness;
  const age = fact.reviewedAt ? (Date.parse(p.mission.asOfDate) - Date.parse(logDay(fact.reviewedAt))) / 86400000 : Infinity;
  if (freshness !== 'stale') {
    if (!fact.reviewedAt || age < 0 || !supports.length) freshness = 'unknown';
    else {
      const intervals = supports.map(l => lookup(l.sourceRef.id)!.reviewIntervalDays).filter((v): v is number => v !== null);
      if (!intervals.length) freshness = 'unknown';
      else if (!intervals.some(days => age <= days)) freshness = 'stale';
    }
  }
  if (freshness !== 'current') reasons.push('时效为历史/过期/未知；重新打开URL不会刷新实质核查日期。');
  if (changedSource) reasons.push('来源出现新版本；当前事实仍绑定旧版本，需要核对并重新绑定。');
  const refs = fact.evidenceLinks.map(l => l.sourceRef);
  const review = p.meaningReviews.some(r => refKey(r.factRef) === refKey(fact) &&
    refKey(r.missionRef) === refKey(p.mission) && r.authorType === 'self' && !r.imported &&
    refs.length === r.sourceRefs.length && refs.every(ref => r.sourceRefs.some(s => refKey(s) === refKey(ref))));
  const needsReview = changedSource || !review;
  if (!review) reasons.push('本事实、任务与来源组合尚无本人语义核查记录；自动测试不能代替。');
  const valueKnown = fact.value !== null && !(typeof fact.value === 'object' && 'value' in fact.value && fact.value.value === null);
  if (!valueKnown) reasons.push('原始值未知；不能作为已知数值或确定能力使用。');
  const eligibleForClaim = !fact.archived && valueKnown && supportStatus === 'supported' && applicability === 'in_scope' && freshness === 'current' && !needsReview;
  return { supportStatus, applicability, freshness, needsReview, eligibleForClaim, reasons };
}
