/** Which node a task's link should attach to in the constellation graph.
 *
 *  A task belongs to the session that created it, but not every session id has
 *  a node: the default conversation is not in the session list at all, and a
 *  session can be deleted while its tasks are still on screen. A link to a
 *  missing node renders as a line into nothing, so those fall back to the core.
 *
 *  The fallback is deliberately NOT the currently open session: that is what the
 *  graph used to do, and it drew every Telegram task as a child of whichever
 *  thread the operator happened to have open.
 */
export function taskLinkTarget(
  taskSessionId: string | null | undefined,
  knownSessionIds: Iterable<string>,
): string {
  if (!taskSessionId) return 'core';
  for (const id of knownSessionIds) {
    if (id === taskSessionId) return taskSessionId;
  }
  return 'core';
}
