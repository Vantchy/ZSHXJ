/** Full definitions are immutable; progress belongs only to the per-user save. */
export type QuestStatus = 'not-accepted' | 'accepted' | 'completed' | 'submitted';
export type StepStatus = 'pending' | 'current' | 'done' | 'skipped';
export type CompletionMode = 'official-circuit' | 'test-only' | 'not-implemented';
export interface QuestStepDefinition {
  id: string;
  title: string;
  description: string;
  condition: Record<string, unknown> | null;
}
export interface QuestCompletion { mode: CompletionMode; levelIds: string[]; }
export interface QuestDefinition {
  id: string;
  type: 'main' | 'side';
  title: string;
  description: string;
  hint: string;
  chapterId: string;
  locationId: string | null;
  steps: QuestStepDefinition[];
  prerequisites: string[];
  rewards: Array<Record<string, unknown>>;
  tags: string[];
  completion: QuestCompletion;
}
export interface StepProgress {
  status: StepStatus;
  updatedAt: string | null;
  evidence: Record<string, unknown> | null;
}
export interface QuestProgress {
  status: QuestStatus;
  steps: Record<string, StepProgress>;
  acceptedAt: string | null;
  completedAt: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
}
export interface QuestCollection {
  schemaVersion: 1;
  main: QuestProgress;
  side: Record<string, QuestProgress>;
}
export function emptyQuestProgress(quest?: QuestDefinition | null): QuestProgress;
export function normalizeQuestProgress(data: unknown, quest?: QuestDefinition | null): QuestProgress;
export function normalizeQuestCollection(data: unknown, definitions?: {main?: QuestDefinition | null; side?: QuestDefinition[]}): QuestCollection;
export function changeQuestStatus(progress: QuestProgress, status: QuestStatus): QuestProgress;
export function advanceTestStep(progress: QuestProgress, definition: QuestDefinition): QuestProgress;
export function currentTestStep(quest: QuestDefinition, progress: QuestProgress): QuestStepDefinition | null;
export const QUEST_STATUSES: ReadonlyArray<QuestStatus>;
export const STEP_STATUSES: ReadonlyArray<StepStatus>;
