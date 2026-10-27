/** Keep personal practice, automated QA and the default workspace on distinct keys. */
export function workspaceScope(search:string,dev:boolean) {
  const q=new URLSearchParams(search), valid=(v:string|null)=>v!==null&&/^[a-z0-9-]{1,40}$/.test(v);
  const practice=q.get('practice'),test=q.get('testStorage');
  if(valid(practice))return {kind:'practice' as const,namespace:'launchproof.practice.'+practice};
  if(dev&&valid(test))return {kind:'test' as const,namespace:'launchproof.test.'+test};
  if(practice!==null||test!==null)throw new Error('副本地址无效，请从验收指南打开正确链接；未访问默认数据。');
  return {kind:'default' as const,namespace:undefined};
}
