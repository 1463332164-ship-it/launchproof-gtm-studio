import { describe, expect, it } from 'vitest';
import seed from '../../src/data/us-curtain.seed.json';
import { previewImport, serializeProject } from '../../src/infrastructure/importExport';
import { addResearchExamples, saveResearch, saveEntity, editMission, checkMessage, recordMeaningReview, replaceProject, setResearchWeights, currentMessageRefs } from '../../src/application/projectCommands';
import { buildComparison, compareCosts, formatValue, toMillimetres } from '../../src/domain/comparison';
import type { CostQuote } from '../../src/domain/comparison';
import { normalizeWeights, scoreBarrier, sensitivity, rankBarriers, DEFAULT_WEIGHTS } from '../../src/domain/priority';
import { canonicalize, sha256, messageFingerprint, reviewMessage, refsFromText } from '../../src/domain/messageReview';
import { latest } from '../../src/domain/refs';
import { validateProject } from '../../src/domain/validation';
import type { Project, Message } from '../../src/domain/entities';

const ctx={now:'2026-10-25T05:00:00Z',reason:'合成自动测试；不是用户核查或实际用户研究',author:'ai_assisted' as const};
const base=()=>previewImport(JSON.stringify(seed));
const fixture=()=>addResearchExamples(base(),ctx);
const message=(p:Project,id='M-A')=>latest(p.messages).find(m=>m.id===id)!;
const fact=(p:Project,id='F008')=>latest(p.facts).find(f=>f.id===id)!;
const scored=(p:Project)=>p.barriers.map((b,i)=>({...b,impact:i===0?4:3,relevance:i===0?4:3,actionability:i===0?1:4})).slice(0,2);
const quote:CostQuote={amountMinor:10000,currency:'USD',quantity:1,bundle:'same configuration',hubIncluded:true,taxShippingBasis:'excluded',discountBasis:'none',market:'US',asOfDate:'2026-10-25'};
async function reviewedFixture() {
  const p=recordMeaningReview(fixture(),'F008',{...ctx,author:'self'});
  return checkMessage(p,'M-A',1,{...ctx,author:'self'},true);
}
describe('LP03 comparison and draft boundaries',()=>{
  it('derives exactly six dimensions without mutating the original facts or sources',()=>{
    const p=base(), before=JSON.stringify(p); expect(buildComparison(p)).toHaveLength(6); expect(JSON.stringify(p)).toBe(before);
  });
  it('keeps exact threshold 0.625 inch = 15.875 mm',()=>expect(toMillimetres(.625,'inch')).toBe(15.875));
  it.each(['cm','USD',''])('rejects unsupported length unit %s',unit=>expect(()=>toMillimetres(1,unit)).toThrow());
  it('rejects nonfinite lengths',()=>expect(()=>toMillimetres(Infinity,'mm')).toThrow());
  it('does not confuse explicit false with unknown',()=>{
    const p=base(); expect(formatValue(fact(p,'F003'))).toContain('明确不支持'); expect(formatValue({...fact(p),value:null})).toContain('未知');
  });
  it('keeps generic exclusion visible but not a Type 1 rule',()=>{
    const row=buildComparison(base()).find(r=>r.id==='structure')!;
    expect(row.cells[0]!.missing).toBe(true); expect(row.cells[0]!.summary).toContain('15.875'); expect(row.cells[0]!.facts[0]!.applicability).toBe('out_of_scope');
  });
  it('cost and availability remain unknown; official URL is not stock',()=>{
    const rows=buildComparison(base()); for(const id of ['cost','availability']) expect(rows.find(r=>r.id===id)!.cells.every(c=>c.missing)).toBe(true);
  });
  it('compares only complete same-basis USD cost fixtures',()=>expect(compareCosts(quote,{...quote,amountMinor:12000})).toMatchObject({comparable:true,differenceMinor:-2000}));
  it.each(['currency','quantity','bundle','hubIncluded','taxShippingBasis','discountBasis','market','asOfDate'] as const)('rejects missing cost field %s',key=>expect(compareCosts(quote,{...quote,[key]:null}).comparable).toBe(false));
  it.each([{currency:'EUR'},{market:'CA'},{quantity:2},{asOfDate:'2026-10-24'},{bundle:'different'},{taxShippingBasis:'included'},{hubIncluded:false},{discountBasis:'coupon'}])('rejects incomparable quote %j',patch=>expect(compareCosts(quote,{...quote,...patch}).comparable).toBe(false));
  it('rejects non-USD even if both quotes match',()=>expect(compareCosts({...quote,currency:'EUR'},{...quote,currency:'EUR'}).comparable).toBe(false));
  it('creates three untested hypotheses and two explicitly unreviewed drafts',()=>{
    const p=fixture(); expect(p.hypotheses).toHaveLength(3); expect(p.messages).toHaveLength(2);
    expect(p.hypotheses.every(h=>h.researchStatus==='untested'&&h.actualSampleSize===0&&!h.observationRefs.length)).toBe(true);
    expect(p.messages.every(m=>m.reviewState==='draft'&&!m.inputFingerprint&&!m.humanReview)).toBe(true);
    expect(p.facts).toEqual(base().facts); expect(p.sources).toEqual(base().sources); expect(p.meaningReviews).toHaveLength(0);
  });
  it('never overwrites existing examples',()=>expect(()=>addResearchExamples(fixture(),ctx)).toThrow('已经存在'));
  it('accepts schema 1.2 while preserving old 1.0 import',()=>{expect(fixture().schemaVersion).toBe('1.2.0');expect(base().schemaVersion).toBe('1.0.0');});
  it.each([{actualSampleSize:1},{researchStatus:'supported_in_sample'},{falsificationCriterion:''},{basisRefs:[{id:'missing',revision:1}]}])('rejects invalid or invented research %j',patch=>{
    const p=fixture(); expect(()=>saveResearch(p,'hypotheses',{...p.hypotheses[0]!,...patch},1,ctx)).toThrow();
  });
  it('rejects a hypothesis using a message as its evidence',()=>{
    const p=fixture(); expect(()=>saveResearch(p,'hypotheses',{...p.hypotheses[0]!,basisRefs:[{id:'M-A',revision:1}]},1,ctx)).toThrow();
  });
  it('rejects scored barriers without independent reasons',()=>{
    const p=fixture(); expect(()=>saveResearch(p,'barriers',{...p.barriers[0]!,impact:4},1,ctx)).toThrow();
  });
});
describe('LP03 transparent priority and six one-weight perturbations',()=>{
  it('reproduces 85 / 80 hand calculation',()=>{
    const [a,b]=scored(fixture()); expect(scoreBarrier(a!,DEFAULT_WEIGHTS).point).toBe(85); expect(scoreBarrier(b!,DEFAULT_WEIGHTS).point).toBe(80);
  });
  it('runs exactly six distinct plus/minus20% perturbations and renormalizes',()=>{
    const results=sensitivity(scored(fixture()),DEFAULT_WEIGHTS); expect(results).toHaveLength(6);
    expect(new Set(results.map(r=>r.key+r.multiplier)).size).toBe(6);
    results.forEach(r=>expect(Object.values(r.weights).reduce((a,b)=>a+b,0)).toBeCloseTo(1,12));
    const action=results.find(r=>r.key==='actionability'&&r.multiplier===1.2)!;
    expect(action.ranked[0]!.point).toBeCloseTo(82.6923076923,9); expect(action.ranked[1]!.point).toBeCloseTo(80.7692307692,9);
  });
  it('missing score is an interval, never a zero-score rank',()=>{
    const p=fixture(); const b={...p.barriers[0]!,impact:4}; expect(scoreBarrier(b,DEFAULT_WEIGHTS)).toEqual({min:50,max:100,point:null});
    expect(rankBarriers([b],DEFAULT_WEIGHTS).ranked).toHaveLength(0);
  });
  it('zero is a real score',()=>expect(scoreBarrier({impact:0,relevance:0,actionability:0},DEFAULT_WEIGHTS).point).toBe(0));
  it.each([{impact:0,relevance:0,actionability:0},{impact:-1,relevance:1,actionability:1},{impact:Infinity,relevance:1,actionability:1}])('rejects invalid weights %j',w=>expect(()=>normalizeWeights(w)).toThrow());
  it('normalizes large finite weights without overflow',()=>expect(normalizeWeights({impact:1e308,relevance:1e308,actionability:1e308}).impact).toBeCloseTo(1/3));
  it.each([-1,1.5,5,NaN])('rejects invalid score %s',impact=>expect(()=>scoreBarrier({impact,relevance:1,actionability:1},DEFAULT_WEIGHTS)).toThrow());
  it('ties are stable by ID and explicitly flagged',()=>{
    const b=scored(fixture())[0]!; const ranked=rankBarriers([{...b,id:'Z'},{...b,id:'A'}],DEFAULT_WEIGHTS).ranked;
    expect(ranked.map(x=>x.id)).toEqual(['A','Z']); expect(ranked.every(x=>x.tied&&x.nearTie)).toBe(true);
  });
  it('flags near ties without calling them exact ties',()=>{
    const b=scored(fixture())[0]!; const ranked=rankBarriers([b,{...b,id:'other',actionability:2}],{impact:50,relevance:49,actionability:1}).ranked;
    expect(ranked.every(x=>x.nearTie&&!x.tied)).toBe(true);
  });
});
describe('LP03 bilingual review, scope and immutable dependency state',()=>{
  it('AI checks cannot promote seed claims to personal approval',async()=>{
    const p=fixture(); expect((await reviewMessage(p,message(p))).state).toBe('blocked');
    const next=await checkMessage(p,'M-B',1,ctx,true); expect(message(next,'M-B').reviewState).toBe('needs_review');
    expect(message(next,'M-B').humanReview!.bilingualConfirmed).toBe(false);
  });
  it('synthetic personally attested eligible fixture can be ready with limits',async()=>{
    const p=await reviewedFixture(); expect(message(p).reviewState).toBe('ready_with_limits');
    expect((await reviewMessage(p,message(p))).state).toBe('ready_with_limits');
    expect(message(p).inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it('blocks missing English qualifier',async()=>{
    const p=fixture(),m=structuredClone(message(p,'M-B'));m.claimItems[0]!.qualifierEn=null;
    expect((await reviewMessage(p,m)).blockingIssues.join()).toContain('限定语');
  });
  it('blocks differing numbers in translation',async()=>{
    const p=fixture(),m=structuredClone(message(p,'M-B'));m.claimItems[1]!.qualifierEn='Sample size 5';
    expect((await reviewMessage(p,m)).blockingIssues.join()).toContain('数字不一致');
  });
  it('warns about overclaims without treating regex as a truth certificate',async()=>{
    const p=fixture(),m={...message(p,'M-B'),headlineZh:'保证所有窗帘提升转化'};
    expect((await reviewMessage(p,m)).warnings.join()).toContain('过强');
    expect((await reviewMessage(p,m)).state).not.toBe('ready_with_limits');
  });
  it('blocks factual claims that omit original conditions',async()=>{
    const p=await reviewedFixture(),m=structuredClone(message(p));m.claimItems[0]!.qualifierZh='仅供参考';
    expect((await reviewMessage(p,m)).blockingIssues.join()).toContain('全部适用条件');
  });
  it('historical or unresolved evidence cannot become a factual claim',async()=>{
    const p=fixture(),m=structuredClone(message(p,'M-B'));m.claimItems[0]!.kind='fact';
    expect((await reviewMessage(p,m)).blockingIssues.join()).toContain('不是当前合格事实');
  });
  it('a comparison requires both qualified sides even for analysis',async()=>{
    const p=fixture(),m=structuredClone(message(p,'M-B'));m.claimItems[0]!.comparisonScope={dimension:'diameter',productRefs:p.products.map(x=>({id:x.id,revision:x.revision})),conditions:'标称杆径'};
    m.claimItems[0]!.basisRefs=[{id:'F001',revision:1},{id:'F002',revision:1}];
    expect((await reviewMessage(p,m)).blockingIssues.join()).toContain('两侧同条件');
  });
  it('changing a fact invalidates actual downstream messages and retains snapshots',async()=>{
    const p=await reviewedFixture(),old=structuredClone(message(p));const next=saveEntity(p,'facts',{...fact(p),conditions:['合成修改，不是官方新资料']},1,ctx);
    expect(message(next).reviewState).toBe('needs_review');expect(next.messages.find(m=>m.id===old.id&&m.revision===old.revision)).toEqual(old);
    expect((await reviewMessage(next,message(next))).changed).toBe(true);
  });
  it('changing a source invalidates dependent messages',()=>{
    const p=fixture(),src=p.sources.find(s=>s.id===fact(p).evidenceLinks[0]!.sourceRef.id)!;
    const next=saveEntity(p,'sources',{...src,summary:src.summary+' 合成修改'},src.revision,ctx);expect(message(next).reviewState).toBe('needs_review');
  });
  it('changing mission invalidates both messages',()=>{
    const p=fixture(),next=editMission(p,{...p.mission,question:'合成任务调整'},1,ctx);expect(latest(next.messages).every(m=>m.reviewState==='needs_review')).toBe(true);
  });
  it('an unrelated fact does not invalidate or alter M-A fingerprint',async()=>{
    const p=fixture(),old=await messageFingerprint(p,message(p));const f=fact(p,'F004');const next=saveEntity(p,'facts',{...f,reviewNote:'合成注释'},1,ctx);
    expect(message(next)).toEqual(message(p));expect(await messageFingerprint(next,message(next))).toBe(old);
  });
  it('hypothesis and weight changes invalidate their dependent messages',()=>{
    const p=fixture(),next=saveResearch(p,'hypotheses',{...p.hypotheses[0]!,statement:'合成新假设，未验证'},1,ctx);expect(message(next).reviewState).toBe('needs_review');
    expect(latest(setResearchWeights(p,{impact:1,relevance:1,actionability:1},ctx).messages).every(m=>m.reviewState==='needs_review')).toBe(true);
  });
  it('editing reviewed text always creates an unreviewed draft',async()=>{
    const p=await reviewedFixture(),m=message(p),next=saveResearch(p,'messages',{...m,headlineZh:'新草案'},m.revision,ctx);
    expect(message(next)).toMatchObject({reviewState:'draft',inputFingerprint:null,humanReview:null});expect(message(next).claimItems.every(c=>!c.humanMeaningReview)).toBe(true);
  });
  it('stale edits and duplicate IDs are rejected',()=>{
    const p=fixture();expect(()=>saveResearch(p,'messages',message(p),9,ctx)).toThrow('版本');expect(()=>saveResearch(p,'messages',message(p),null,ctx)).toThrow('ID');
  });
  it('rebinding is explicit and does not reapprove message',()=>{
    const p=fixture(),next=editMission(p,{...p.mission,question:'合成更改'},1,ctx);const m=currentMessageRefs(next,message(next));expect(m.missionRef.revision).toBe(2);expect(m.reviewState).toBe('needs_review');
  });
  it('restoration retains reviews as imported history but removes current approval',async()=>{
    const p=await reviewedFixture(),next=replaceProject(base(),p);expect(message(next).reviewState).toBe('needs_review');expect(message(next).humanReview!.imported).toBe(true);
    expect(next.meaningReviews.every(r=>r.imported)).toBe(true);
  });
  it('JSON round trip retains complete LP03 data and version history',async()=>{
    const p=await reviewedFixture();const next=previewImport(serializeProject(p));expect(next).toEqual(p);
  });
  it('rejects imported duplicate claims, dangling and wrong-kind references',()=>{
    for(const change of [
      (m:Message)=>{m.claimItems.push(m.claimItems[0]!);},
      (m:Message)=>{m.barrierRefs=[{id:'missing',revision:1}];},
      (m:Message)=>{m.segmentHypothesisRef={id:'F001',revision:1};}
    ]){const p=fixture();change(p.messages[0]!);expect(validateProject(p).ok).toBe(false);}
  });
  it('rejects unsupported Decision and Scenario payloads until their milestones',()=>{
    const p=fixture();expect(validateProject({...p,decisions:[{id:'D1'}]}).ok).toBe(false);expect(validateProject({...p,scenarios:[{id:'SC1'}]}).ok).toBe(false);
  });
  it('canonicalization ignores key and versioned collection order',async()=>{
    const a={b:2,a:[{id:'Z',revision:1},{id:'A',revision:2}]},b={a:[{revision:2,id:'A'},{revision:1,id:'Z'}],b:2};
    expect(canonicalize(a)).toBe(canonicalize(b));expect(await sha256(a)).toBe(await sha256(b));
  });
  it('fingerprint changes when message text changes',async()=>{
    const p=fixture(),m=message(p);expect(await messageFingerprint(p,m)).not.toBe(await messageFingerprint(p,{...m,headlineZh:'不同草案'}));
  });
  it('reference input parser requires explicit pinned versions',()=>{
    expect(refsFromText('F001@1, F002@2')).toHaveLength(2);expect(()=>refsFromText('F001')).toThrow();
  });
});
