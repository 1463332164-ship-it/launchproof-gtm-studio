import { describe, expect, it } from 'vitest';
import seed from '../../src/data/us-curtain.seed.json';
import type { Decision, Project } from '../../src/domain/entities';
import { addResearchExamples, checkMessage, editMission, replaceProject, saveDecision, saveEntity, saveResearch, setResearchWeights } from '../../src/application/projectCommands';
import { newDecision, assessDecision, decisionFingerprint, pinnedClosure, rebindDecision } from '../../src/domain/decision';
import { createBrief, inspectBrief, briefSections, escapeMarkdown } from '../../src/application/exportBrief';
import { previewImport, serializeProject } from '../../src/infrastructure/importExport';
import { asRef, latest, refKey } from '../../src/domain/refs';
import { validateProject } from '../../src/domain/validation';
const ctx={now:'2026-10-25T12:00:00Z',author:'ai_assisted' as const,reason:'合成自动测试，不是用户亲自确认'};
const request={language:'bilingual' as const,mode:'draft' as const,generatedAt:ctx.now,author:'ai_assisted' as const,semanticConfirmed:false};
const fixture=()=>addResearchExamples(previewImport(JSON.stringify(seed)),ctx);
const last=(p:Project)=>latest(p.decisions)[0]!;
function draft(p:Project):Decision {
  return {...newDecision(p,latest(p.messages).map(asRef),ctx.now),selectedOptionId:'O2',rationale:'测试：先研究配置透明，不代表销量提升',tradeoffs:['未选A：事实型主张本人尚未核查'],
    counterSearchNote:'尚未开展真实反证研究',unresolvedGaps:['人群与效果未验证，完整配置成本未知'],revisitTriggers:['取得同范围反证时重审'],owner:'合成测试责任，非真实审批人',
    supportingRefs:[{id:'H003',revision:1}],nextSteps:[{action:'拟议理解任务，未招募',owner:'待本人安排',criterion:'先观察是否识别前提，再决定是否改文案',dueDate:null}]};
}
const recorded=async()=>{const p=fixture();return saveDecision(p,draft(p),null,ctx,true,false);};
async function reviewedFixture(){
  let p=fixture();p=await checkMessage(p,'M-B',1,{...ctx,author:'self'},true);
  p=await saveDecision(p,draft(p),null,{...ctx,author:'self'},true,true);return p;
}
describe('LP04 decision contract and responsibility',()=>{
  it('records an explicit AI research proposal without inventing personal approval',async()=>{
    const p=await recorded();expect(last(p)).toMatchObject({state:'recorded',personalReview:null,purpose:'research_only',createdBy:'ai_assisted'});
    expect(p.schemaVersion).toBe('1.3.0');expect(p.meaningReviews).toHaveLength(0);expect((await assessDecision(p,last(p))).needsReview).toBe(false);
  });
  it.each(['single','no choice','no rationale','no tradeoff','no counter','no trigger','no owner','no next step','no gaps'])('rejects incomplete recorded decision: %s',async mode=>{
    const p=fixture(),d=draft(p);
    if(mode==='single')d.options=d.options.slice(1);
    if(mode==='no choice')d.selectedOptionId=null;
    if(mode==='no rationale')d.rationale='';
    if(mode==='no tradeoff')d.tradeoffs=[];
    if(mode==='no counter')d.counterSearchNote='';
    if(mode==='no trigger')d.revisitTriggers=[];
    if(mode==='no owner')d.owner='';
    if(mode==='no next step')d.nextSteps=[];
    if(mode==='no gaps')d.unresolvedGaps=[];
    await expect(saveDecision(p,d,null,ctx,true,false)).rejects.toThrow();
  });
  it('permits incomplete draft with one option and no selected outcome',async()=>{
    const p=fixture(),d=newDecision(p,[asRef(p.messages[0]!)],ctx.now);const next=await saveDecision(p,d,null,ctx,false,false);expect(last(next).state).toBe('draft');
  });
  it('a blocked message may remain unselected, never the adopted proposal',async()=>{
    const p=fixture(),d=draft(p);d.selectedOptionId='O1';await expect(saveDecision(p,d,null,ctx,true,false)).rejects.toThrow('阻断');
    d.options.push({id:'defer',summary:'先核查',kind:'defer',messageRefs:[],scenarioRefs:[]});d.selectedOptionId='defer';
    expect(last(await saveDecision(p,d,null,ctx,true,false)).selectedOptionId).toBe('defer');
  });
  it('AI cannot create an externally approved decision even with personalConfirmed=true',async()=>{
    const p=fixture(),d={...draft(p),purpose:'external_message' as const};await expect(saveDecision(p,d,null,ctx,true,true)).rejects.toThrow();
  });
  it('records self declaration only in a synthetic self fixture',async()=>{
    const p=await reviewedFixture();expect(last(p).personalReview?.authorType).toBe('self');
    expect((await assessDecision(p,last(p))).errors).toEqual([]);
  });
  it('rejects duplicated option IDs, dangling/wrong kind refs and scenario refs',()=>{
    const p=fixture(),d=draft(p);
    const variants=[{...d,options:[d.options[0]!,d.options[0]!]},{...d,supportingRefs:[{id:'missing',revision:1}]},{...d,options:[{...d.options[0]!,messageRefs:[{id:'F001',revision:1}]}]},{...d,options:[{...d.options[0]!,scenarioRefs:[{id:'SC1',revision:1}]}]}];
    for(const x of variants)expect(validateProject({...p,decisions:[x]}).ok).toBe(false);
  });
  it('rejects stale edits and cross-kind ID collision',async()=>{
    const p=await recorded();await expect(saveDecision(p,last(p),99,ctx,false,false)).rejects.toThrow('版本');
    await expect(saveDecision(p,{...last(p),id:'F001'},null,ctx,false,false)).rejects.toThrow('ID');
  });
  it('preserves previous decisions and an explicit change reason',async()=>{
    const p=await recorded(),old=structuredClone(last(p));const next=await saveDecision(p,{...old,rationale:'测试第二次取舍'},old.revision,ctx,true,false);
    expect(next.decisions[0]).toEqual(old);expect(last(next).previousDecisionRef).toEqual(asRef(old));expect(last(next).changeReason).toBe(ctx.reason);
  });
});
describe('LP04 real dependency propagation',()=>{
  it.each(['fact','source','mission','message','message_review','hypothesis','weights'])('%s changes invalidate actual Decision and preserve history',async kind=>{
    const p=await recorded(),old=structuredClone(last(p));let next=p;
    if(kind==='fact'){const f=p.facts.find(f=>f.id==='F008')!;next=saveEntity(p,'facts',{...f,conditions:[...f.conditions,'合成测试条件']},1,ctx);}
    if(kind==='source'){const s=p.sources.find(s=>s.id==='S01')!;next=saveEntity(p,'sources',{...s,limitation:s.limitation+' 合成测试'},1,ctx);}
    if(kind==='mission')next=editMission(p,{...p.mission,question:'新的合成研究问题'},1,ctx);
    if(kind==='message'){const m=p.messages.find(m=>m.id==='M-B')!;next=saveResearch(p,'messages',{...m,headlineZh:'新的研究草案'},1,ctx);}
    if(kind==='message_review')next=await checkMessage(p,'M-B',1,ctx,false);
    if(kind==='hypothesis'){const h=p.hypotheses.find(h=>h.id==='H003')!;next=saveResearch(p,'hypotheses',{...h,statement:'合成调整的未验证假设'},1,ctx);}
    if(kind==='weights')next=setResearchWeights(p,{impact:.4,relevance:.4,actionability:.2},ctx);
    expect(last(next).state).toBe('needs_review');expect(next.decisions[0]).toEqual(old);
    expect((await assessDecision(next,last(next))).needsReview).toBe(true);
  });
  it('unrelated source does not invalidate Decision',async()=>{
    const p=await recorded(),s=p.sources.find(s=>s.id==='S07')!;const next=saveEntity(p,'sources',{...s,limitation:'合成无关来源修改'},1,ctx);
    expect(last(next)).toEqual(last(p));expect(await decisionFingerprint(next,last(next))).toBe(await decisionFingerprint(p,last(p)));
  });
  it('same-scope synthetic counter-evidence triggers contested fact and decision review',async()=>{
    const p=await recorded(),f=p.facts.find(f=>f.id==='F003')!;
    const next=saveEntity(p,'facts',{...f,evidenceLinks:[...f.evidenceLinks,{...f.evidenceLinks[0]!,relation:'contradicts',applicabilityNote:'合成反证夹具，不是实际官网反证'}]},1,ctx);
    expect(latest(next.facts).find(x=>x.id==='F003')!.supportStatus).toBe('contested');expect(last(next).state).toBe('needs_review');
  });
  it('explicit rebind updates direct references but does not silently reapprove',async()=>{
    const p=await recorded(),m=p.messages.find(x=>x.id==='M-B')!,next=saveResearch(p,'messages',{...m,headlineZh:'合成更新'},1,ctx);
    const rebound=rebindDecision(next,last(next));expect(rebound.options[1]!.messageRefs[0]!.revision).toBe(2);expect(rebound.state).toBe('needs_review');
  });
  it('a historical recorded revision is not current-reviewed after a newer decision',async()=>{
    const p=await recorded(),old=last(p),next=await saveDecision(p,{...old,rationale:'合成新版'},old.revision,ctx,true,false);
    expect((await assessDecision(next,old)).needsReview).toBe(true);
  });
});
describe('LP04 report traceability and conservative export',()=>{
  it('exports a real dependency closure with unique exact versions and source appendix',async()=>{
    const p=await recorded(),d=last(p),out=await createBrief(p,d,request);
    expect(new Set(out.snapshot.dependencyRefs.map(refKey)).size).toBe(out.snapshot.dependencyRefs.length);
    expect(out.snapshot.dependencyRefs.map(refKey)).toContain('F008@1');
    expect(out.snapshot.sourceAppendix.some(s=>s.id==='S01')).toBe(true);
    expect(out.markdown).toContain('DRAFT');expect(out.markdown).toContain('English missing');expect(out.markdown).toContain('actual sample 0');
    expect(out.snapshot.personalContribution.selfDeclaredEvents).toBe(0);
  });
  it('source appendix contains exact URL locator access date and limits',async()=>{
    const p=await recorded(),out=await createBrief(p,last(p),request),s=out.snapshot.sourceAppendix.find(s=>s.id==='S04')!;
    expect(s.url).toContain('aqara.com');expect(s.locator).toBeTruthy();expect(s.accessedAt).toBeTruthy();expect(s.limitation).toBeTruthy();
    expect(out.markdown).toContain('Source limits');
  });
  it('pinned historical export never substitutes new fact text',async()=>{
    const p=await recorded(),d=last(p),f=p.facts.find(f=>f.id==='F008')!;
    const next=saveEntity(p,'facts',{...f,statementZh:'UNIQUE_NEW_FACT_TEXT'},1,ctx);
    const out=await createBrief(next,d,request);
    expect(out.snapshot.dependencyRefs.map(refKey)).toContain('F008@1');expect(out.snapshot.dependencyRefs.map(refKey)).not.toContain('F008@2');
    expect(out.markdown).not.toContain('UNIQUE_NEW_FACT_TEXT');expect(out.snapshot.warnings.join()).toContain('旧依据');
  });
  it('all rendered comparison references belong to the pinned closure',async()=>{
    const p=await recorded(),out=await createBrief(p,last(p),request);
    for(const key of out.markdown.match(/F\d{3}@\d+/g)??[])expect(out.snapshot.dependencyRefs.map(refKey)).toContain(key);
  });
  it('draft can disclose unknown evidence; reviewed is blocked without personal checks',async()=>{
    const p=await recorded(),d=last(p);
    expect((await inspectBrief(p,d,{...request,mode:'reviewed'})).blockers.length).toBeGreaterThan(0);
    await expect(createBrief(p,d,{...request,mode:'reviewed'})).rejects.toThrow();
  });
  it('missing English blocks full bilingual reviewed, but Chinese draft works',async()=>{
    const p=await reviewedFixture(),d=last(p),r={...request,mode:'reviewed' as const,author:'self' as const,semanticConfirmed:true};
    expect((await inspectBrief(p,d,r)).blockers.join()).toContain('英文缺失');
    expect((await createBrief(p,d,{...request,language:'zh'})).markdown).not.toContain('[English missing');
  });
  it('reviewed Chinese requires an actual confirmation flag and ready chosen message',async()=>{
    const p=await reviewedFixture(),r={...request,language:'zh' as const,mode:'reviewed' as const,author:'self' as const,semanticConfirmed:true};
    expect((await createBrief(p,last(p),r)).markdown).toContain('AUTHOR REVIEWED WITH LIMITS');
    await expect(createBrief(p,last(p),{...r,semanticConfirmed:false})).rejects.toThrow('本人');
  });
  it('synthetic translations support complete reviewed path, never auto-filled in product',async()=>{
    let p=await reviewedFixture();let d=last(p);const english:Record<string,string>={};
    for(const f of briefSections(p,d).flatMap(s=>s.fields))if(!f.en)english[f.key]='Synthetic fixture translation '+(f.zh.match(/\d+(?:\.\d+)?/g)??[]).join(' ');
    p=await saveDecision(p,{...d,english},d.revision,{...ctx,author:'self'},true,true);d=last(p);
    const r={...request,mode:'reviewed' as const,author:'self' as const,semanticConfirmed:true};const check=await inspectBrief(p,d,r);
    expect(check.missing).toHaveLength(0);expect(check.mismatches).toHaveLength(0);expect(check.blockers).toHaveLength(0);
    expect((await createBrief(p,d,r)).snapshot.mode).toBe('reviewed');
  });
  it('bilingual numeric mismatch is reported and blocks reviewed export',async()=>{
    const p=await reviewedFixture(),d=structuredClone(last(p));d.english['F001@1.statement']='Range 999 mm';
    const withEdit={...p,decisions:p.decisions.map(x=>x.id===d.id&&x.revision===d.revision?d:x)};
    expect((await inspectBrief(withEdit,d,{...request,mode:'reviewed',author:'self',semanticConfirmed:true})).mismatches.length).toBeGreaterThan(0);
  });
  it('report source text cannot inject HTML links or active Markdown',()=>{
    const out=escapeMarkdown('<script>alert(1)</script> [click](javascript:alert(1)) ![x](https://example.test)');
    expect(out).not.toContain('<script>');expect(out).toContain('\\[click\\]');expect(out).toContain('\\!');
  });
  it('snapshot restore preserves links/history but invalidates imported review',async()=>{
    const p=await reviewedFixture(),out=await createBrief(p,last(p),request);const imported=previewImport(out.json);
    expect(imported.decisions).toEqual(p.decisions);
    const restored=replaceProject(fixture(),imported);expect(last(restored).state).toBe('needs_review');expect(last(restored).personalReview!.imported).toBe(true);
  });
  it('plain JSON round trip keeps all Decision versions',async()=>{
    const p=await recorded(),next=await saveDecision(p,last(p),1,ctx,false,false);expect(previewImport(serializeProject(next))).toEqual(next);
  });
  it('rejects wrong snapshot format, bad project and oversized envelope',()=>{
    expect(()=>previewImport(JSON.stringify({format:'other',project:seed,snapshot:{}}))).toThrow();
    expect(()=>previewImport(JSON.stringify({format:'launchproof-brief/1',project:{broken:true},snapshot:{}}))).toThrow();
    expect(()=>previewImport(JSON.stringify({format:'launchproof-brief/1',project:seed,snapshot:{padding:'x'.repeat(2100000)}}))).toThrow('2MiB');
  });
  it('pinned closure refuses dangling decision dependencies',async()=>{
    const p=await recorded(),d=last(p);expect(()=>pinnedClosure({...p,messages:[]},d)).toThrow('引用缺失');
  });
  it('no V2 scenario payload is accepted',async()=>{
    const p=await recorded();expect(validateProject({...p,scenarios:[{id:'SC1'}]}).ok).toBe(false);
  });
});

it('AI English drafts preserve exact-text binding and never establish personal review',async()=>{
  const p=await recorded(),d=last(p),fields=briefSections(p,d).flatMap(s=>s.fields);
  const f=fields.find(x=>x.translationOrigin==='ai_draft')!;
  expect(f).toBeTruthy();expect((await inspectBrief(p,d,request)).warnings.join()).toContain('AI-assisted');
  expect(d.personalReview).toBeNull();
  const modified=structuredClone(p);const fact=modified.facts.find(x=>x.conditions.some(c=>fields.some(v=>v.zh===c&&v.translationOrigin==='ai_draft')))!;
  fact.conditions=['UNIQUE NEW CONDITION 待翻译'];
  expect(briefSections(modified,d).flatMap(s=>s.fields).find(x=>x.zh==='UNIQUE NEW CONDITION 待翻译')?.en).toBeNull();
});

it('Insight inference and its premises remain distinct in the exported closure',async()=>{
  let p=fixture();p.insights.push({id:'I-SYN',revision:1,createdAt:ctx.now,updatedAt:ctx.now,createdBy:'ai_assisted',archived:false,statementZh:'合成分析：结构需单独核对',statementEn:'Synthetic inference: check structure separately',premiseRefs:[{id:'F003',revision:1}],counterEvidenceRefs:[],reasoning:'技术排除不等于用户发生率',limitation:'未开展用户研究',reviewState:'draft'});
  const d=draft(p);d.supportingRefs.push({id:'I-SYN',revision:1});p=await saveDecision(p,d,null,ctx,true,false);
  const out=await createBrief(p,last(p),request);expect(out.snapshot.sections.find(s=>s.ref.id==='I-SYN')?.kind).toContain('Insight');
  expect(out.markdown).toContain('未开展用户研究');expect(out.snapshot.dependencyRefs.map(refKey)).toContain('F003@1');
  const f=p.facts.find(f=>f.id==='F003')!;const next=saveEntity(p,'facts',{...f,conditions:['合成条件变化']},1,ctx);
  expect(latest(next.insights)[0]?.reviewState).toBe('needs_review');expect(last(next).state).toBe('needs_review');
});
it('Chinese string values are not presented as completed English translation',async()=>{
  const p=await recorded(),fields=briefSections(p,last(p)).flatMap(s=>s.fields);
  expect(fields.find(f=>f.key==='F005@1.value')?.translationOrigin).toBe('missing');
});
