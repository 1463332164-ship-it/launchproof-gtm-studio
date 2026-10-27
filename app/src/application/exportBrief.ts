import type { Decision, Project, Ref } from '../domain/entities';
import { assessDecision, pinnedClosure } from '../domain/decision';
import { assessEvidence } from '../domain/evidence';
import { asRef, currentEntity, pinnedEntity, refKey } from '../domain/refs';
import { RULES_VERSION, sha256 } from '../domain/messageReview';
import { MAX_IMPORT_BYTES, validateProject } from '../domain/validation';
import { buildComparison } from '../domain/comparison';
import { scoreBarrier } from '../domain/priority';
import { englishDrafts } from '../data/englishDrafts';

export interface BriefField {key:string;label:string;zh:string;en:string|null;translationOrigin:'author_entry'|'provided'|'ai_draft'|'missing'}
export interface BriefSection {ref:Ref;kind:string;status:string;fields:BriefField[]}
export type Language='zh'|'en'|'bilingual';
export type Mode='draft'|'reviewed';
export interface BriefRequest {language:Language;mode:Mode;generatedAt:string;author:'self'|'ai_assisted';semanticConfirmed:boolean}
export function briefSections(p:Project,d:Decision):BriefSection[] {
  return pinnedClosure(p,d).map(e=>{
    const fields:BriefField[]=[];
    const add=(path:string,label:string,zh:string,en:string|null=null)=>{
      if(!zh)return;const key=refKey(e)+'.'+path;
      fields.push({key,label,zh,en:d.english[key]??en??englishDrafts[zh]??null,
        translationOrigin:d.english[key]?'author_entry':en?'provided':englishDrafts[zh]?'ai_draft':'missing'});
    };
    let kind='',status='';
    if('options' in e){
      kind='Decision / 策略记录';status=e.state+' / '+e.purpose+' / '+(e.personalReview&&!e.personalReview.imported?'author confirmation recorded':'AI-assisted or unconfirmed');
      add('question','Decision question / 决策问题',e.question);add('rationale','Rationale / 选择理由',e.rationale);
      for(const [i,o] of e.options.entries())add('options.'+i,'Option '+o.id+(o.id===e.selectedOptionId?' [SELECTED / 所选]':' [NOT SELECTED / 未选]')+' / '+o.messageRefs.map(refKey).join(', '),o.summary);
      e.tradeoffs.forEach((x,i)=>add('tradeoffs.'+i,'Trade-off / 未选理由',x));
      add('counterSearchNote','Counter-evidence search / 反证寻找说明',e.counterSearchNote);
      e.unresolvedGaps.forEach((x,i)=>add('gaps.'+i,'Unresolved / 未决事项',x));
      e.revisitTriggers.forEach((x,i)=>add('triggers.'+i,'Revisit trigger / 复核触发',x));
      e.nextSteps.forEach((x,i)=>{add('steps.'+i+'.action','Next validation / 下一步验证 · Owner '+x.owner+' · Due '+(x.dueDate??'unknown'),x.action);add('steps.'+i+'.criterion','Decision rule / 判断规则',x.criterion);});
      add('evidence','Supporting / Counter refs',e.supportingRefs.map(refKey).join(', ')+' / '+e.counterRefs.map(refKey).join(', '),e.supportingRefs.map(refKey).join(', ')+' / '+e.counterRefs.map(refKey).join(', '));
    }else if('focalProductRef' in e){
      kind='Mission / 研究任务';status=e.market+' / '+e.asOfDate;
      add('question','Research question / 研究问题',e.question);
      e.successCriteria.forEach((x,i)=>add('success.'+i,'Success criteria / 研究标准',x));e.exclusions.forEach((x,i)=>add('exclusions.'+i,'Exclusion / 排除范围',x));
    }else if('claimItems' in e){
      kind='Message / 信息方案';const selected=d.options.find(o=>o.id===d.selectedOptionId)?.messageRefs.some(r=>refKey(r)===refKey(e));
      status=e.reviewState+' / '+(selected?'selected research material':'alternative, NOT endorsed');
      add('headline','Headline / 标题',e.headlineZh,e.headlineEn);add('value','Value proposition / 价值主张',e.valuePropositionZh,e.valuePropositionEn);
      add('target','Target hypothesis / 人群假设',refKey(e.segmentHypothesisRef),refKey(e.segmentHypothesisRef));
      for(const c of e.claimItems){
        add(c.id+'.text',c.kind+' / '+c.id+' / '+c.basisRefs.map(refKey).join(', '),c.textZh,c.textEn);
        add(c.id+'.qualifier','LIMITS / 限定语',c.qualifierZh??'[中文限定语缺失]',c.qualifierEn);
      }
      add('cta','Next action / 下一步行动',e.callToAction);
    }else if('evidenceLinks' in e){
      kind='Fact / 资料记录，非实测';const a=assessEvidence(e,p);status=[a.supportStatus,a.applicability,a.freshness,a.eligibleForClaim?'eligible narrow claim':'LIMITED CONTEXT / 不作当前已核事实卖点'].join(' / ');
      add('statement','Recorded statement / 窄表述',e.statementZh,e.statementEn);
      e.conditions.forEach((x,i)=>add('conditions.'+i,'CONDITION / 条件',x));
      const value=JSON.stringify(e.value);add('value','Original value and unit / 原值与单位',value,typeof e.value==='string'&&/[\u3400-\u9fff]/.test(e.value)?null:value);
      const refs=e.evidenceLinks.map(l=>refKey(l.sourceRef)+' ('+l.relation+')').join(', ');add('sources','Sources / 来源',refs,refs);
    }else if('researchStatus' in e){
      kind='Hypothesis / 未验证假设';status=e.researchStatus+' / actual sample '+e.actualSampleSize+' / planned sample '+e.validationPlan.plannedSampleSize+' (design assumption)';
      add('statement','Hypothesis / 假设',e.statement);add('segment','Segment assumption / 人群假设',e.segment);add('context','Context / 情境',e.context);
      add('basis','Basis and limits / 设计依据',e.basisNote);add('falsification','Falsification / 反证条件',e.falsificationCriterion);
      for(const k of ['method','recruitmentCriteria','task','measure','decisionRule'] as const)add('plan.'+k,'Proposed / 拟议 '+k,e.validationPlan[k]);
    }else if('hypothesisRef' in e){
      kind='Barrier / 设计评分';const score=scoreBarrier(e,e.weights);status='Not observed frequency / 非发生率 · '+(score.point===null?score.min.toFixed(1)+'–'+score.max.toFixed(1)+' incomplete':score.point.toFixed(1));
      add('label','Barrier / 障碍',e.label);add('note','Evidence limits / 证据局限',e.evidenceNote);
      for(const k of ['impact','relevance','actionability'] as const)add('reason.'+k,k+'='+e[k]+'; weight='+e.weights[k]+' (design)',e.scoreRationale[k]);
    }else if('premiseRefs' in e){
      kind='Insight / 分析推断';status=e.reviewState;
      add('statement','Inference / 分析',e.statementZh,e.statementEn);add('reasoning','Reasoning / 推理',e.reasoning);add('limitation','Limits / 边界',e.limitation);
    }else if('url' in e){
      kind='Source / 来源附录';status=e.accessStatus+' / '+e.market+' / '+e.productScope.join(', ');
      add('title','Original source title / 原始标题',e.title,e.title);
      add('url','Original URL',e.url,e.url);add('locator','Original locator / 原始定位',e.locator,e.locator);
      add('accessedAt','Access date / 访问日',e.accessedAt,e.accessedAt);add('summary','Source summary / 摘要',e.summary);add('limitation','Source limits / 来源限制',e.limitation);
    }else if('modelName' in e){
      kind='Product / 精确型号';status=e.market;add('model','Model / 型号',e.brand+' '+e.modelName+' '+e.variant,e.brand+' '+e.modelName+' '+e.variant);
    }
    return {ref:asRef(e),kind,status,fields};
  });
}
const numericTokens=(s:string)=>[...new Set(s.match(/\d+(?:\.\d+)?/g)??[])].sort().join('|');
export async function inspectBrief(p:Project,d:Decision,request:BriefRequest) {
  const sections=briefSections(p,d),assessment=await assessDecision(p,d);
  const missing=sections.flatMap(s=>s.fields).filter(f=>!f.en?.trim());
  const mismatches=sections.flatMap(s=>s.fields).filter(f=>f.en&&numericTokens(f.zh)!==numericTokens(f.en));
  const blockers:string[]=[];const warnings=[...assessment.errors,...assessment.warnings];
  if(assessment.needsReview)warnings.push('旧依据或决定待复核 / Outdated decision or dependencies');
  if(request.mode==='reviewed'){
    if(d.state!=='recorded'||assessment.needsReview||assessment.errors.length)blockers.push('决定尚未完成当前版本复核');
    if(!d.personalReview||d.personalReview.imported)blockers.push('缺少本人对决定的确认');
    const selected=d.options.find(o=>o.id===d.selectedOptionId);
    for(const r of selected?.messageRefs??[]){const m=currentEntity(p,r);if(!m||!('claimItems' in m)||m.reviewState!=='ready_with_limits')blockers.push(r.id+'信息仍未复核');}
    if(request.language!=='zh'&&(missing.length||mismatches.length))blockers.push('英文缺失或数字不一致：'+missing.length+' / '+mismatches.length);
    if(request.author!=='self'||!request.semanticConfirmed)blockers.push('需要本人确认导出含义、主张强度与限定语');
  }
  if(missing.length)warnings.push('English fields missing: '+missing.length+' / 英文字段缺失');
  if(sections.some(s=>s.fields.some(f=>f.translationOrigin==='ai_draft')))warnings.push('Known-text English drafts are AI-assisted and require personal semantic review. / 已知原文的英文草稿由AI辅助，仍需本人语义核查。');
  if(mismatches.length)warnings.push('Bilingual numeric mismatch: '+mismatches.length+' / 中英数字不一致');
  return {sections,missing,mismatches,blockers:[...new Set(blockers)],warnings:[...new Set(warnings)],assessment};
}
export function escapeMarkdown(s:string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g,'\\$1').replace(/\r?\n/g,'  \n');
}
export async function createBrief(p:Project,d:Decision,request:BriefRequest) {
  if(!validateProject(p).ok)throw new Error('项目结构或引用无效，不能导出');
  if(!Number.isFinite(Date.parse(request.generatedAt)))throw new Error('导出时间无效');
  const check=await inspectBrief(p,d,request);if(check.blockers.length)throw new Error(check.blockers.join('；'));
  const inputFingerprint=await sha256({projectRevision:p.projectRevision,decisionFingerprint:check.assessment.fingerprint,language:request.language,mode:request.mode,sections:check.sections});
  const nodes=pinnedClosure(p,d);
  const boundMission=pinnedEntity(p,d.missionRef);if(!boundMission||!('focalProductRef' in boundMission))throw new Error('任务引用缺失');
  const comparisonProject={...p,mission:boundMission,facts:nodes.filter(e=>'evidenceLinks' in e)};
  const snapshot={exportId:'EX-'+crypto.randomUUID(),generatedAt:request.generatedAt,asOfDate:boundMission.asOfDate,schemaVersion:p.schemaVersion,rulesVersion:RULES_VERSION,
    projectRevision:p.projectRevision,language:request.language,mode:request.mode,decisionRef:asRef(d),dependencyRefs:nodes.map(asRef),inputFingerprint,
    warnings:check.warnings,sourceAppendix:nodes.filter(e=>'url' in e),sections:check.sections,
    personalContribution:{statement:'AI assistance and self-declared actions are separate. No automatic U1 completion. / AI辅助不等于本人完成U1。',selfDeclaredEvents:p.changeEvents.filter(e=>e.authorType==='self').length,aiAssistedEvents:p.changeEvents.filter(e=>e.authorType==='ai_assisted').length}};
  const lines=['# LaunchProof GTM Brief',request.mode==='draft'?'**DRAFT / 不完整研究草稿，待核查**':'**AUTHOR REVIEWED WITH LIMITS / 作者复核，非企业批准**',
    'No market validation or sales uplift established. / 不代表市场验证或销量提升。',
    'Decision '+refKey(d)+' · Project revision '+p.projectRevision+' · US · asOf '+boundMission.asOfDate,
    'Generated '+request.generatedAt+' · '+request.language+' · rules '+RULES_VERSION+' · SHA-256 '+inputFingerprint,
    '## Gaps and review warnings / 缺口与复核提示',...check.warnings.map(w=>'- '+escapeMarkdown(w))];
  for(const [index,section] of check.sections.entries()){
    lines.push('## ['+(index+1)+'] '+refKey(section.ref)+' · '+section.kind,escapeMarkdown(section.status));
    for(const f of section.fields){
      lines.push('**'+escapeMarkdown(f.label)+'**');
      if(request.language!=='en')lines.push(escapeMarkdown(f.zh));
      if(request.language!=='zh')lines.push(escapeMarkdown(f.en??'[English missing; original retained] '+f.zh));
    }
  }
  lines.push('## Comparison boundaries / 比较边界',...buildComparison(comparisonProject).map(r=>'- '+r.id+': '+(r.hasUnknown?'Incomplete / 未知或资料不完整':'Conditional specifications only / 仅标称条件')+'; '+r.cells.flatMap(c=>c.basisRefs.map(refKey)).join(', ')),
    '## Operating scenarios / 经营情景','Not modelled in V1; demand, budget and returns were not evaluated. / V1未建模需求、预算或收益。',
    '## Contribution / 贡献声明',escapeMarkdown(snapshot.personalContribution.statement),
    'Self-declared events / 本人自述操作记录: '+snapshot.personalContribution.selfDeclaredEvents+'; AI-assisted events: '+snapshot.personalContribution.aiAssistedEvents,
    'No automatic claim of independent authorship, user research, U1 completion or commercial results. / 不自动声称独立编写、用户研究、U1完成或商业成果。');
  const json=JSON.stringify({format:'launchproof-brief/1',snapshot,project:p},null,2);
  if(new TextEncoder().encode(json).byteLength>MAX_IMPORT_BYTES)throw new Error('简报快照超过2MiB，请先导出普通JSON备份并缩小研究范围');
  return {snapshot,markdown:lines.join('\n\n')+'\n',json,filename:'LaunchProof-'+p.projectId+'-'+request.generatedAt.slice(0,10)+'-r'+p.projectRevision+'-'+d.id+'-v'+d.revision+'-'+request.language+'-'+request.mode};
}
