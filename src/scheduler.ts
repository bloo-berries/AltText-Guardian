/**
 * Pure decision logic for the checkDescription scheduler job.
 *
 * Isolating this from Devvit-context side effects (Redis, Reddit, Gemini)
 * keeps the state machine testable.
 */

export type SchedulerInput = {
  /** True if this runner won the NX lock for the post. */
  lockAcquired: boolean;
  /** True if `nudged:<postId>` already exists in Redis. */
  nudgedExists: boolean;
  /** True if `compliant:<postId>` already exists in Redis. */
  compliantExists: boolean;
  /** Result of hasDescription() against the freshly re-fetched post. */
  hasDescription: boolean;
};

export type SchedulerDecision =
  /** Another runner holds the lock; do nothing. */
  | { kind: 'skip'; reason: 'lock_held' }
  /** PostUpdate already moved this post to compliant; clean up pending. */
  | { kind: 'skip'; reason: 'already_compliant' }
  /** A prior scheduler run already nudged; this is a retry. */
  | { kind: 'skip'; reason: 'already_nudged' }
  /** OP added a description during the grace period; claim compliance. */
  | { kind: 'mark_compliant' }
  /** Still no description; proceed to post the nudge. */
  | { kind: 'post_nudge' };

export function decideSchedulerAction(input: SchedulerInput): SchedulerDecision {
  if (!input.lockAcquired) return { kind: 'skip', reason: 'lock_held' };
  if (input.compliantExists) return { kind: 'skip', reason: 'already_compliant' };
  if (input.nudgedExists) return { kind: 'skip', reason: 'already_nudged' };
  if (input.hasDescription) return { kind: 'mark_compliant' };
  return { kind: 'post_nudge' };
}
