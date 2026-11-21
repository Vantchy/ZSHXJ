/**
 * Adapt a real dialogue player's terminal event to one ordered quest step.
 * A client callback is not cryptographic evidence of reading; the server still
 * validates quest identity, sequence, official grades and prerequisites.
 * This function never writes a save or mutates the supplied progress.
 */
import {finishFlowDialogue} from './quest-flow.js';
import {resolveQuestDestination} from './quest-navigation.js';

export function prepareQuestDialogueFinish({chapter, state, locationId,
  context, finalParagraphId, allowHistorical = false} = {}) {
  if (context?.kind !== 'quest-target' || !context.questId ||
      !context.stepId || !context.entryId || !finalParagraphId) return null;
  const definitions = [chapter?.quests?.main, ...(chapter?.quests?.side || [])].filter(Boolean);
  const quest = definitions.find(item => item.id === context.questId);
  if (!quest?.completion?.requireAllSteps) return null;
  const progress = quest === chapter.quests.main
    ? state?.tasks?.main : state?.tasks?.side?.[quest.id];
  // Existing v0.8 saves may have a submitted quest with an unrecorded
  // narrative step. A configured scene may fill only that missing step,
  // never rewind an already completed step or re-award submission rewards.
  if (!progress || (progress.status !== 'accepted' &&
      !(allowHistorical && ['completed','submitted'].includes(progress.status)))) return null;
  const step = quest.steps.find(item => item.id === context.stepId);
  if (!step || step.condition?.type !== 'dialogue-finished' ||
      step.condition.dialogueId !== finalParagraphId) return null;

  // A stale task-book selection cannot finish a later step or a different
  // authored route. The same resolver is used for the visible "前往" button.
  const destination = resolveQuestDestination({
    entry:{quest,progress}, chapter, state, locationId,
  });
  if (destination.reason || destination.target?.type !== 'dialogue' ||
      destination.target.id !== context.entryId ||
      destination.stepId !== context.stepId) return null;

  const updated = finishFlowDialogue(progress, quest, {
    stepId:step.id, dialogueId:finalParagraphId,
  });
  if (JSON.stringify(updated) === JSON.stringify(progress)) return null;
  return {
    quest, stepId:step.id, progress, updated,
    checkpoint:`quest_dialogue_${quest.id}_${step.id}_finished`,
  };
}
