import type { Barrier, Hypothesis, Message, Project, Ref } from '../domain/entities';
import { DEFAULT_WEIGHTS } from '../domain/priority';
import { asRef, latest } from '../domain/refs';
export function createResearchDrafts(p:Project,now:string) {
  const base=(id:string)=>({id,revision:1,createdAt:now,updatedAt:now,createdBy:'ai_assisted' as const,archived:false});
  const facts=(ids:string[])=>ids.flatMap(id=>{const f=latest(p.facts).find(x=>x.id===id&&!x.archived);return f?[asRef(f)]:[];});
  const plan={method:'拟议任务观察，尚未招募',recruitmentCriteria:'有美国使用情境、实际考虑既有窗帘自动化的人',task:'解释一份配置说明，再比较两份信息材料',measure:'是否独立找出关键前提、解释是否正确',decisionRule:'拟议：5人中至少2人独立漏看同一前提则优先改善说明；非总体发生率',plannedSampleSize:5};
  const statements=[
    ['H001','部分希望改装既有窗帘的人可能把杆径符合误认为整体可安装。','考虑改装既有窗帘的人（待验证）','核对杆径与杆结构','若目标样本无需提示始终主动检查结构，则降低或缩小该假设。',['F001','F002','F003']],
    ['H002','计划接入Apple Home的人可能不清楚品牌桥接器与平台控制器的区别。','计划接入Apple Home的人（待验证）','购买前识别所需设备','若目标样本无需提示即可列出完整设备与限制，则降低该假设。',['F005','F006']],
    ['H003','对首次接触此类设备的人，先解释购买前提可能比只强调便利更有助于理解。','首次接触窗帘自动化的人（待验证）','比较改装便利与配置透明信息','若交替呈现时配置前提说明未改善理解或引入误解，则缩小或推翻假设。',['F008','F003']],
  ] as const;
  const hypotheses:Hypothesis[]=statements.map(([id,statement,segment,context,falsificationCriterion,ids])=>({...base(id),statement,segment,context,falsificationCriterion,basisRefs:facts([...ids]),basisNote:'来自原规划的设计假设；依据技术条件提出问题，没有访谈或发生率证据。',validationPlan:{...plan},researchStatus:'untested',actualSampleSize:0,observationRefs:[],owner:'待用户指定',nextReviewDate:null}));
  const barriers:Barrier[]=hypotheses.map((h,i)=>({...base('B00'+(i+1)),hypothesisRef:asRef(h),label:['尺寸与结构条件可能混淆','生态设备层级可能混淆','购买前提说明是否易理解'][i]!,impact:null,relevance:null,actionability:null,
    scoreRationale:{impact:'',relevance:'',actionability:''},weights:{...DEFAULT_WEIGHTS},evidenceNote:'设计假设，实际样本0；评分待作者给出理由，不预填痛点强度。'}));
  const claim=(id:string,kind:'fact'|'inference'|'hypothesis',textZh:string,textEn:string,basisRefs:Ref[],qualifierZh:string,qualifierEn:string)=>({id,kind,textZh,textEn,basisRefs,qualifierZh,qualifierEn,comparisonScope:null,humanMeaningReview:false});
  const f8=latest(p.facts).find(f=>f.id==='F008');
  const messages:Message[]=[
    {...base('M-A'),missionRef:asRef(p.mission),segmentHypothesisRef:asRef(hypotheses[0]!),barrierRefs:[asRef(barriers[0]!)],
      headlineZh:'为既有窗帘探索自动化，先确认杆式安装条件。',headlineEn:'Explore automation for your existing curtains. Check rod installation requirements first.',
      valuePropositionZh:'改装便利是待检验的信息方向；先说明厂商设计，再保留购买前提。',valuePropositionEn:'Retrofit convenience is a research direction. Explain the vendor design and retain purchase conditions.',
      claimItems:[claim('CA1','fact',f8?.statementZh??'厂商安装描述待补资料',f8?.statementEn??'Vendor installation description needs evidence.',facts(['F008']),f8?.conditions.join(' ')??'原始事实缺失，需补资料。','This is a vendor design description, not an installation test by this project. Suitability for renters is unproven.'),
        claim('CA2','hypothesis','部分改装用户可能需要先分清尺寸与结构条件。','Some retrofit users may need to distinguish dimensions from structural requirements.',[asRef(hypotheses[0]!)],'人群需求尚未验证；样本0。','The segment need is untested; actual sample size is 0.')],
      callToAction:'先检查杆径和结构；本研究样稿不是购买认证。',reviewState:'draft',reviewerNote:'',inputFingerprint:null,humanReview:null},
    {...base('M-B'),missionRef:asRef(p.mission),segmentHypothesisRef:asRef(hypotheses[2]!),barrierRefs:[asRef(barriers[1]!),asRef(barriers[2]!)],
      headlineZh:'先核对窗帘条件和生态设备，再决定自动化方案。',headlineEn:'Check curtain requirements and ecosystem devices before choosing an automation setup.',
      valuePropositionZh:'配置透明是本项目的信息策略假设，不代表已验证定位或品牌完整核查。',valuePropositionEn:'Configuration transparency is a messaging hypothesis, not validated positioning or a complete brand check.',
      claimItems:[claim('CB1','inference','购买前建议分别核对品牌桥接器与平台控制器。','Before purchase, check the brand bridge and platform controller separately.',facts(['F005','F006']),'此为研究建议；Type 1组合待核，历史公告不能证明当前完整兼容。','This is research guidance. Type 1 configurations need verification; a historical announcement does not establish current complete compatibility.'),
        claim('CB2','hypothesis','先解释前提可能帮助首次接触者理解方案。','Explaining prerequisites first may help new users understand the setup.',[asRef(hypotheses[2]!)],'信息效果未验证，样本0，不代表转化提升。','Message effectiveness is untested, with sample size 0; no conversion improvement is established.')],
      callToAction:'列出未知配置并安排核查，不作无条件兼容承诺。',reviewState:'draft',reviewerNote:'',inputFingerprint:null,humanReview:null},
  ];
  return {hypotheses,barriers,messages};
}

