/** Resolve actors from authored location placements, preserving the V8 lone NPC. */
import {ROOM_NPC_X} from './room-world.js';
import {sceneConfig} from './quest-scene.js';

export function sceneQuestsAtLocation(chapter, locationId) {
  return [chapter?.quests?.main, ...(chapter?.quests?.side || [])]
    .filter(quest => sceneConfig(chapter, quest, locationId));
}

export function createRoomActors(chapter, location, characters = {}) {
  const quests = sceneQuestsAtLocation(chapter, location?.id);
  const slots = Array.isArray(location?.characterPlacements) &&
    location.characterPlacements.length ? location.characterPlacements : null;
  if (!slots) return [{
    id: location?.characterId || 'legacy-npc',
    name: location?.npc || chapter?.npc || '人物',
    x: ROOM_NPC_X,
    questId: quests.length === 1 ? quests[0].id : null,
    dialogueId: location?.dialogueId || null,
    npcLine: location?.npcLine || chapter?.npcLine || '',
  }];
  const bound = new Set(slots.map(slot => slot.questId).filter(Boolean));
  const unassignedScene = quests.length === 1 && !bound.has(quests[0].id)
    ? quests[0] : null;
  const primary = unassignedScene && (
    slots.find(slot => characters?.[slot.characterId]?.name === (location?.npc || chapter?.npc)) ||
    slots[0]
  );
  return slots.map(slot => ({
    id:slot.characterId,
    name:characters?.[slot.characterId]?.name || slot.characterId,
    x:slot.x,
    questId:slot.questId || (primary === slot ? unassignedScene?.id : null),
    dialogueId:slot.dialogueId || null,
    npcLine:'',
  }));
}

export function actorForQuest(actors, questId) {
  return actors.find(actor => actor.questId === questId) || null;
}

export function closestActor(actors, x, limit = Infinity) {
  let nearest = null;
  let best = limit;
  for (const actor of actors) {
    const distance = Math.abs(x - actor.x);
    if (distance <= best && (distance < best || !nearest)) {
      nearest = actor;
      best = distance;
    }
  }
  return nearest;
}
