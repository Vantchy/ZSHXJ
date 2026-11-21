/**
 * Monotonic client-side progress reconciliation.
 *
 * GET /api/progress can be answered from an older database snapshot even
 * after a newer PUT has completed. Never replace a chapter with an older or
 * equal revision, and never erase entries only because an older GET omitted
 * them. A server-side revision conflict remains authoritative.
 */
export class StaleOperationError extends Error {
  constructor(message = '此操作所属页面或读取请求已经失效。') {
    super(message);
    this.name = 'StaleOperationError';
    this.code = 'STALE_OPERATION';
  }
}

const validRevision = value =>
  Number.isSafeInteger(value) && value >= 0 ? value : -1;

export function mergeRevisionedProgress(saved, records) {
  if (!(saved instanceof Map) || !Array.isArray(records)) {
    throw new TypeError('进度合并需要 Map 缓存及服务端进度数组');
  }
  for (const entry of records) {
    if (!entry || typeof entry.chapterId !== 'string' || !entry.chapterId) {
      continue;
    }
    const previous = saved.get(entry.chapterId);
    // Same revision is already locally present (possibly with newer in-memory
    // client metadata); preserve it to avoid time-of-check/time-of-use rewinds.
    if (previous &&
        validRevision(previous.revision) >= validRevision(entry.revision)) {
      continue;
    }
    saved.set(entry.chapterId, entry);
  }
}
