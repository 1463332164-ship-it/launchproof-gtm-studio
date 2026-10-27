import type { Fact, Project, Ref } from './entities';
import { assessEvidence } from './evidence';
import { asRef, latest } from './refs';
export const DIMENSIONS = [
  { id:'diameter', label:'杆径范围', predicates:['rod_diameter_range'], note:'仅比较官方标称尺寸；更宽范围不等于更好体验。' },
  { id:'structure', label:'固定 / 伸缩结构', predicates:['extendable_rods_supported','generic_extendable_rod_exclusion'], note:'尺寸符合不能覆盖结构排除；通用Rod资料不能套用Type 1。' },
  { id:'ecosystem', label:'生态接入前提', predicates:['radio_protocol','apple_bridge_requirements','historical_m2_beta_listing'], note:'品牌Hub、平台控制器、地区和固件需分别核对。' },
  { id:'installation', label:'安装 / 使用承诺', predicates:['vendor_installation_description'], note:'厂商描述不等于实测；没有同条件安装用时测试。' },
  { id:'cost', label:'完整配置成本', predicates:[], note:'单台/套装、Hub、税运、币种和日期口径未齐，不计算价差。' },
  { id:'availability', label:'美国渠道可得性', predicates:[], note:'官方信息入口不等于库存或全美送达证明。' },
] as const;
export function toMillimetres(value: number, unit: string): number {
  if (!Number.isFinite(value)) throw new Error('长度必须为有限值');
  if (unit === 'mm') return value;
  if (unit === 'inch') return value * 25.4;
  throw new Error('不支持的长度单位：' + unit);
}
export function formatValue(f: Fact): string {
  const v = f.value;
  if (v === null) return '未知 / 待补资料';
  if (typeof v === 'boolean') return v ? '原资料明确列出（用途需看限定）' : '明确不支持（并非未知）';
  if (typeof v === 'string') return v;
  if ('min' in v) {
    const original = (v.inclusiveMin ? '[' : '(') + v.min + ', ' + v.max + (v.inclusiveMax ? ']' : ')') + ' ' + v.unit;
    return v.unit === 'inch' ? original + ' = ' + toMillimetres(v.min,v.unit) + '–' + toMillimetres(v.max,v.unit) + ' mm' : original;
  }
  if (v.value === null) return '未知 / ' + v.missingReason;
  return v.value + ' ' + v.unit + (v.unit === 'inch' ? ' = ' + toMillimetres(v.value,v.unit) + ' mm（不舍入阈值）' : '');
}
export interface CostQuote {
  amountMinor: number|null; currency: string|null; quantity: number|null; bundle: string|null;
  hubIncluded: boolean|null; taxShippingBasis: string|null; discountBasis:string|null; market:string|null; asOfDate:string|null;
}
export function compareCosts(a: CostQuote, b: CostQuote) {
  const keys = ['currency','quantity','bundle','hubIncluded','taxShippingBasis','discountBasis','market','asOfDate'] as const;
  const invalid = [a,b].some(q => Object.values(q).some(v => v === null || v === '') || q.amountMinor! < 0 || !Number.isSafeInteger(q.amountMinor) || !Number.isSafeInteger(q.quantity) || q.quantity! <= 0);
  if (invalid || keys.some(k => a[k] !== b[k]) || a.market !== 'US' || a.currency !== 'USD') return { comparable:false, differenceMinor:null, reason:'不完整配置成本或比较口径不同' };
  return { comparable:true, differenceMinor:a.amountMinor! - b.amountMinor!, reason:'同口径条件比较，不代表更优价值' };
}
export function buildComparison(p: Project) {
  const facts = latest(p.facts).filter(f => !f.archived);
  const products = [p.mission.focalProductRef,...p.mission.competitorRefs].map(r => p.products.find(x => x.id === r.id && x.revision === r.revision)!);
  return DIMENSIONS.map(d => {
    const cells = products.map(product => {
      const matched = facts.filter(f => f.subjectRef.id === product.id && (d.predicates as readonly string[]).includes(f.predicate));
      const usable = matched.filter(f => { const a=assessEvidence(f,p); return a.supportStatus === 'supported' && a.applicability === 'in_scope' && a.freshness === 'current'; });
      const missing = d.id === 'cost' || d.id === 'availability' || usable.length === 0;
      const sourceRefs: Ref[] = d.id === 'availability' ? product.sourceRefs : [];
      return { product, facts:matched, basisRefs:matched.map(asRef), sourceRefs, missing,
        status: d.id === 'cost' ? '不可比' : missing ? '未知 / 待核' : matched.some(f=>!assessEvidence(f,p).eligibleForClaim) ? '条件性 / 本人待复核' : '条件性资料可用',
        summary:d.id === 'cost' ? '不完整配置成本：SKU/套装/Hub/税运待核' : d.id === 'availability' ? '有官方信息入口；库存与送达未知' : matched.length ? matched.map(formatValue).join('；') : '未知 / 待补资料' };
    });
    const comparable = d.id === 'diameter' && cells.every(c => !c.missing);
    return { ...d, cells, status:comparable ? '可作标称条件比较' : '条件性 / 不完整', hasUnknown:cells.some(c=>c.missing), hasDifference:cells[0]!.summary !== cells[1]!.summary };
  });
}

