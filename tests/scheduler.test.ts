import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  decideSchedulerAction,
  type SchedulerDecision,
  type SchedulerInput,
} from '../src/scheduler.js';

describe('decideSchedulerAction', () => {
  test('no lock -> skip lock_held', () => {
    expect(
      decideSchedulerAction({
        lockAcquired: false,
        nudgedExists: false,
        compliantExists: false,
        hasDescription: false,
      })
    ).toEqual({ kind: 'skip', reason: 'lock_held' });
  });

  test('compliant exists -> skip already_compliant (PostUpdate won)', () => {
    expect(
      decideSchedulerAction({
        lockAcquired: true,
        nudgedExists: false,
        compliantExists: true,
        hasDescription: true,
      })
    ).toEqual({ kind: 'skip', reason: 'already_compliant' });
  });

  test('nudged exists -> skip already_nudged (retry after success)', () => {
    expect(
      decideSchedulerAction({
        lockAcquired: true,
        nudgedExists: true,
        compliantExists: false,
        hasDescription: false,
      })
    ).toEqual({ kind: 'skip', reason: 'already_nudged' });
  });

  test('has description during grace -> mark_compliant', () => {
    expect(
      decideSchedulerAction({
        lockAcquired: true,
        nudgedExists: false,
        compliantExists: false,
        hasDescription: true,
      })
    ).toEqual({ kind: 'mark_compliant' });
  });

  test('no description -> post_nudge', () => {
    expect(
      decideSchedulerAction({
        lockAcquired: true,
        nudgedExists: false,
        compliantExists: false,
        hasDescription: false,
      })
    ).toEqual({ kind: 'post_nudge' });
  });

  test('priority: lock > compliant > nudged > description', () => {
    // All flags set: lock should win first
    expect(
      decideSchedulerAction({
        lockAcquired: false,
        nudgedExists: true,
        compliantExists: true,
        hasDescription: true,
      })
    ).toEqual({ kind: 'skip', reason: 'lock_held' });

    // Lock OK, but both state keys set: compliant wins
    expect(
      decideSchedulerAction({
        lockAcquired: true,
        nudgedExists: true,
        compliantExists: true,
        hasDescription: true,
      })
    ).toEqual({ kind: 'skip', reason: 'already_compliant' });
  });

  test('property: action is total - every input produces exactly one decision', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (lockAcquired, nudgedExists, compliantExists, hasDescription): boolean => {
          const decision: SchedulerDecision = decideSchedulerAction({
            lockAcquired,
            nudgedExists,
            compliantExists,
            hasDescription,
          });
          return (
            decision.kind === 'skip' ||
            decision.kind === 'mark_compliant' ||
            decision.kind === 'post_nudge'
          );
        }
      ),
      { numRuns: 100, seed: 9 }
    );
  });

  test('property: when lock not acquired, decision is always skip(lock_held)', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (nudgedExists, compliantExists, hasDescription): boolean => {
          const input: SchedulerInput = {
            lockAcquired: false,
            nudgedExists,
            compliantExists,
            hasDescription,
          };
          const d = decideSchedulerAction(input);
          return d.kind === 'skip' && d.reason === 'lock_held';
        }
      ),
      { numRuns: 50, seed: 11 }
    );
  });

  test('property: mark_compliant requires hasDescription=true AND no prior state', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (lockAcquired, nudgedExists, compliantExists, hasDescription): boolean => {
          const d = decideSchedulerAction({
            lockAcquired,
            nudgedExists,
            compliantExists,
            hasDescription,
          });
          if (d.kind !== 'mark_compliant') return true; // vacuously true
          return lockAcquired && !nudgedExists && !compliantExists && hasDescription;
        }
      ),
      { numRuns: 100, seed: 17 }
    );
  });
});
