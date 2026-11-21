/**
 * Per-chapter save queue with hard login-session isolation.
 *
 * - A snapshot belongs to the token generation active when queued.
 * - Queued A writes cannot borrow B's auth token after an account switch.
 * - In-flight A responses cannot write into B's local progress cache.
 * - A queued mutation runs *after* older saves and reads the newest saved
 *   chapter state, so score reconciliation never posts an older full snapshot.
 *
 * This is a client data-consistency guard, not a replacement for the server's
 * expectedRevision or official result validation.
 */

export class SessionChangedError extends Error {
  constructor() {
    super('账号会话已切换，旧的存档操作已取消。');
    this.name = 'SessionChangedError';
    this.code = 'SESSION_CHANGED';
  }
}

export function createProgressSaveQueue({
  getSession, isCurrentSession, getProgress, setProgress, sendProgress, copy,
}) {
  if ([getSession, isCurrentSession, getProgress, setProgress,
       sendProgress, copy].some(fn => typeof fn !== 'function')) {
    throw new TypeError('进度队列缺少必要的保存接口');
  }

  const tails = new Map();
  const assertSession = (session) => {
    if (!session?.token || !isCurrentSession(session)) {
      throw new SessionChangedError();
    }
  };

  function enqueue(chapterId, session, action) {
    const previous = tails.get(chapterId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => {
      assertSession(session);
      return action(session);
    });
    tails.set(chapterId, next);
    // Discard idle tails without manufacturing an unhandled rejection.
    const release = () => {
      if (tails.get(chapterId) === next) tails.delete(chapterId);
    };
    next.then(release, release);
    return next;
  }

  async function commit(chapterId, state, checkpoint, session) {
    assertSession(session);
    const expectedRevision = getProgress(chapterId)?.revision ?? 0;
    const reply = await sendProgress(chapterId, {
      checkpoint, state, expectedRevision,
    }, session.token);
    // A stale response must not be allowed to modify a newly logged-in
    // account's saved Map, even when the old HTTP request succeeded.
    assertSession(session);
    if (!reply?.progress) throw new Error('进度保存接口没有返回存档');
    setProgress(chapterId, reply.progress);
    return reply.progress;
  }

  function save(chapterId, state, checkpoint, session = getSession()) {
    // Capture both state and owner NOW, not when this asynchronous job starts.
    const snapshot = copy(state);
    return enqueue(chapterId, session, current =>
      commit(chapterId, snapshot, checkpoint, current));
  }

  function mutateLatest(chapterId, checkpoint, mutate, session = getSession()) {
    if (typeof mutate !== 'function') throw new TypeError('缺少任务合并函数');
    return enqueue(chapterId, session, current => {
      const latest = getProgress(chapterId)?.state;
      if (!latest) return null;
      const next = copy(latest);
      if (!mutate(next)) return null;
      return commit(chapterId, next, checkpoint, current);
    });
  }

  /**
   * Wait for writes already enqueued when the barrier was requested.
   * A level exit or chapter reload must not consume a pre-PUT GET snapshot
   * before the queued PUT has committed. A failed write remains a failure
   * reported to its caller; this read barrier cannot manufacture success.
   */
  async function whenIdle(chapterId = null, session = getSession()) {
    assertSession(session);
    const pending = chapterId == null
      ? [...tails.values()]
      : (tails.has(chapterId) ? [tails.get(chapterId)] : []);
    await Promise.allSettled(pending);
    assertSession(session);
  }

  function invalidatePending() {
    // Old promises retain their original generation and will self-reject.
    // A new account must not wait behind the old account's request queue.
    tails.clear();
  }

  return {save, mutateLatest, whenIdle, invalidatePending};
}
