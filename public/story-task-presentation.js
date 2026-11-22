/** Display-only task classification. Never edits quest definitions, saves, or grades. */
const PLACEHOLDER_IDS = new Set(['main', 'side-test']);
export function isPlaceholderQuest(quest) {
  return !quest || PLACEHOLDER_IDS.has(quest.id) && quest.locationId === 'gate-road';
}
export function questDisplayCategory(quest, chapter) {
  if (isPlaceholderQuest(quest)) return null;
  if (quest?.id === 'binary-decoder' || quest?.locationId === 'gate-road') return 'practice';
  if (chapter?.questTargets?.[quest.id]?.scene) return 'story';
  return quest?.completion?.mode === 'official-circuit' ? 'practice' : 'story';
}
export function visibleTaskEntries(chapter, state) {
  const main=chapter?.quests?.main;
  const sides=chapter?.quests?.side || [];
  return [...(main ? [{key:'main',quest:main,progress:state?.tasks?.main}] : []),
    ...sides.map((quest,i)=>({key:'side:'+(quest.id??i),quest,
      progress:state?.tasks?.side?.[quest.id]}))]
    .map(t=>({...t,category:questDisplayCategory(t.quest,chapter)}))
    .filter(t=>t.category!==null);
}
export function selectVisibleTaskKey(tasks, preferredKey, state, chapter, locationId) {
  if (tasks.some(t=>t.key===preferredKey)) return preferredKey;
  const local=tasks.find(t=>t.category==='story' && t.quest.locationId===locationId &&
    t.progress?.status!=='submitted');
  if(local)return local.key;
  const next=tasks.find(t=>t.category==='story' && t.progress?.status !== 'submitted' &&
    (t.quest.prerequisites||[]).every(id=>state?.tasks?.side?.[id]?.status==='submitted'));
  return (next||tasks[0])?.key||'';
}
