import { describe,it,expect } from 'vitest';
import { workspaceScope } from '../../src/infrastructure/workspaceScope';
describe('V1 isolated personal practice',()=>{
  it('default URL retains existing storage',()=>expect(workspaceScope('',true).namespace).toBeUndefined());
  it('practice is separate from default and QA in dev and production',()=>{
    for(const dev of [true,false])expect(workspaceScope('?practice=v1-personal',dev)).toEqual({kind:'practice',namespace:'launchproof.practice.v1-personal'});
    expect(workspaceScope('?testStorage=v1-personal',true).namespace).toBe('launchproof.test.v1-personal');
  });
  it('practice takes precedence over QA without sharing keys',()=>expect(workspaceScope('?practice=user&testStorage=qa',true).kind).toBe('practice'));
  it.each(['?practice=','?practice=../default','?testStorage=bad_key'])('invalid isolated link never silently falls back to default: %s',s=>expect(()=>workspaceScope(s,true)).toThrow('未访问默认数据'));
  it('production does not accidentally open default for a development QA link',()=>expect(()=>workspaceScope('?testStorage=qa',false)).toThrow());
});

import { readFileSync } from 'node:fs';
import { previewImport } from '../../src/infrastructure/importExport';
import seed from '../../src/data/us-curtain.seed.json';
it('prepared personal practice preserves seed and leaves every personal choice unfilled',()=>{
 const p=previewImport(readFileSync('../examples/research-start.json','utf8'));
 expect(p.facts).toEqual(seed.facts);expect(p.sources).toEqual(seed.sources);
 expect(p.meaningReviews).toHaveLength(0);expect(p.messages.every(m=>m.humanReview===null)).toBe(true);
 expect(p.changeEvents.every(e=>e.authorType==='ai_assisted')).toBe(true);
 expect(p.decisions[0]).toMatchObject({state:'draft',selectedOptionId:null,rationale:'',personalReview:null,nextSteps:[]});
 expect(p.decisions[0]?.options).toHaveLength(3);
});
