/**
 * Per-location room position adapter for the existing chapter JSON save.
 * Preserves the legacy single room's position while letting a newly authored
 * location enter at its own spawnX. No new database table or schema version.
 */
const isX = value => typeof value === 'number' && Number.isFinite(value) &&
  value >= 0 && value <= 1024;
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);

export function enterRoomLocation(state, location, {legacyLocationId = null} = {}) {
  if (!state || !location?.id) throw new Error('缺少有效的房间地点');
  const oldLocationId = state.locationId || legacyLocationId;
  const previousX = isX(state.position?.x) ? state.position.x : null;
  const existing = isRecord(state.locationPositions) ? state.locationPositions : null;
  // Preserve the old single-room save untouched until another location needs
  // independent positions, or until positions were already opted in.
  const track = Boolean(existing || (oldLocationId && oldLocationId !== location.id));
  if (!track) {
    state.locationId = location.id;
    if (previousX == null) state.position = {x:isX(location.spawnX) ? location.spawnX : 180};
    return state.position.x;
  }
  const positions = existing || {};
  if (oldLocationId && previousX !== null && oldLocationId !== location.id) {
    // Preserve the previous room even when its save was written before V7.
    positions[oldLocationId] = {x:previousX};
  }
  const recalled = positions[location.id]?.x;
  const nextX = oldLocationId === location.id && previousX !== null ? previousX
    : isX(recalled) ? recalled : isX(location.spawnX) ? location.spawnX : 180;
  state.position = {x:nextX};
  state.locationId = location.id;
  positions[location.id] = {x:nextX};
  state.locationPositions = positions;
  return nextX;
}

/** Call immediately before each whole-chapter PUT, after local movement. */
export function captureRoomLocationPosition(state, locationId) {
  if (!isRecord(state?.locationPositions)) return;
  if (state.locationId !== locationId || !isX(state.position?.x)) {
    throw new Error('地点与玩家坐标不一致，无法保存');
  }
  state.locationPositions[locationId] = {x:state.position.x};
}
