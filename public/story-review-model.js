/** Return revisit-able steps without generating saves, evidence, or scores. */
export function completedSceneReviewEntries(chapter, quest, progress) {
  const targets=chapter?.questTargets?.[quest?.id]?.steps || {};
  const dialogues=new Set((chapter?.dialogues||[]).map(d=>d.id));
  return (quest?.steps||[]).flatMap(step=>{
    if(progress?.steps?.[step.id]?.status!=='done')return [];
    const condition=step.condition||{};
    if(condition.boardId)return [{stepId:step.id,title:step.title,kind:'board',
      targetId:condition.boardId}];
    if(condition.type==='level-completed' && condition.levelId)
      return [{stepId:step.id,title:step.title,kind:'level',targetId:condition.levelId}];
    const entryId=targets[step.id]?.type==='dialogue' ? targets[step.id].id : condition.dialogueId;
    return dialogues.has(entryId) ? [{stepId:step.id,title:step.title,kind:'dialogue',targetId:entryId}] : [];
  });
}
