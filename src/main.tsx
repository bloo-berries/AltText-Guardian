import { Devvit } from '@devvit/public-api';
import { DEFAULTS, REDIS_KEYS } from './constants.js';
import { isImagePost, hasDescription } from './imageDetection.js';
import { decideSchedulerAction } from './scheduler.js';
import { renderAutoDraft, renderNudge } from './templating.js';
import { generateAltText } from './visionApi.js';

/** Lock TTL for the checkDescription job. Long enough to cover the full
 *  flow (image fetch + Gemini + comment posts) but short enough that a
 *  legitimate retry after a crash can eventually proceed. */
const SCHEDULE_LOCK_TTL_MS = 10 * 60 * 1000;

Devvit.configure({
  redditAPI: true,
  redis: true,
  http: {
    domains: [
      'generativelanguage.googleapis.com',
      'i.redd.it',
      'i.imgur.com',
      'imgur.com',
      'preview.redd.it',
      'external-preview.redd.it',
    ],
  },
});

// ─── Settings ────────────────────────────────────────────────────────────────

Devvit.addSettings([
  {
    name: 'gracePeriodMinutes',
    type: 'number',
    label: 'Grace period (minutes)',
    helpText: 'How long to wait before nudging OP for a description',
    defaultValue: DEFAULTS.gracePeriodMinutes,
    scope: 'installation',
  },
  {
    name: 'minDescriptionLength',
    type: 'number',
    label: 'Minimum description length (characters)',
    helpText: 'Minimum character count to consider a description valid',
    defaultValue: DEFAULTS.minDescriptionLength,
    scope: 'installation',
  },
  {
    name: 'nudgeMessage',
    type: 'paragraph',
    label: 'Custom nudge message',
    helpText: 'Leave blank to use the default. Use {minLength} as a placeholder.',
    defaultValue: '',
    scope: 'installation',
  },
  {
    name: 'enableAutoDraft',
    type: 'boolean',
    label: 'Enable auto-draft alt-text (Gemini 2.5 Flash-Lite vision)',
    defaultValue: DEFAULTS.enableAutoDraft,
    scope: 'installation',
  },
  {
    name: 'enableFlair',
    type: 'boolean',
    label: 'Flair non-compliant posts',
    defaultValue: DEFAULTS.enableFlair,
    scope: 'installation',
  },
  {
    name: 'nonComplianceFlairText',
    type: 'string',
    label: 'Non-compliance flair text',
    defaultValue: DEFAULTS.nonComplianceFlairText,
    scope: 'installation',
  },
  {
    name: 'geminiApiKey',
    type: 'string',
    label: 'Google Gemini API Key',
    helpText:
      'Required for auto-draft. Set via CLI: devvit settings set geminiApiKey. Get a free key at aistudio.google.com/apikey',
    scope: 'app',
    isSecret: true,
  },
]);

// ─── PostSubmit Trigger ──────────────────────────────────────────────────────

Devvit.addTrigger({
  event: 'PostSubmit',
  onEvent: async (event, context) => {
    const postId = event.post?.id;
    if (!postId) return;

    const post = await context.reddit.getPostById(postId);
    if (!isImagePost(post)) return;

    // Increment total image posts counter
    await context.redis.incrBy(REDIS_KEYS.statsTotal, 1);

    const settings = await context.settings.getAll();
    const minLength = (settings.minDescriptionLength as number) ?? DEFAULTS.minDescriptionLength;

    if (hasDescription(post, minLength)) {
      // Already has a description - mark compliant
      await context.redis.set(REDIS_KEYS.compliant(postId), JSON.stringify({ timestamp: Date.now() }));
      await context.redis.incrBy(REDIS_KEYS.statsOrganic, 1);
      return;
    }

    // Store as pending and schedule grace period check
    await context.redis.set(
      REDIS_KEYS.pending(postId),
      JSON.stringify({ timestamp: Date.now(), state: 'pending' })
    );

    const gracePeriod = (settings.gracePeriodMinutes as number) ?? DEFAULTS.gracePeriodMinutes;

    await context.scheduler.runJob({
      name: 'checkDescription',
      data: { postId },
      runAt: new Date(Date.now() + gracePeriod * 60 * 1000),
    });
  },
});

// ─── Scheduler Job: checkDescription ─────────────────────────────────────────

Devvit.addSchedulerJob({
  name: 'checkDescription',
  onRun: async (event, context) => {
    const postId = event.data?.postId as string;
    if (!postId) return;

    // Acquire an NX lock with TTL: prevents concurrent retries from posting
    // duplicate nudge comments or calling Gemini twice. See the matching
    // comment in the PostUpdate handler -- Devvit's redis.set returns a
    // truthy value on success and an empty string when NX-conflict occurs,
    // so `!!lockResult` distinguishes "we acquired it" from "in flight
    // elsewhere".
    const lockResult = await context.redis.set(REDIS_KEYS.scheduleLock(postId), '1', {
      nx: true,
      expiration: new Date(Date.now() + SCHEDULE_LOCK_TTL_MS),
    });

    const [nudgedData, compliantData] = await Promise.all([
      context.redis.get(REDIS_KEYS.nudged(postId)),
      context.redis.get(REDIS_KEYS.compliant(postId)),
    ]);

    const post = await context.reddit.getPostById(postId);
    const settings = await context.settings.getAll();
    const minLength = (settings.minDescriptionLength as number) ?? DEFAULTS.minDescriptionLength;

    const decision = decideSchedulerAction({
      lockAcquired: !!lockResult,
      nudgedExists: !!nudgedData,
      compliantExists: !!compliantData,
      hasDescription: hasDescription(post, minLength),
    });

    if (decision.kind === 'skip') {
      // If PostUpdate already won, clean up any leftover pending entry.
      if (decision.reason === 'already_compliant') {
        await context.redis.del(REDIS_KEYS.pending(postId));
      }
      console.log(`checkDescription: skipping ${postId} - ${decision.reason}`);
      return;
    }

    if (decision.kind === 'mark_compliant') {
      // OP added a description during grace. NX-claim so we don't race with
      // a concurrent PostUpdate path; only the winner increments statsOrganic.
      // Truthy `claim` -> we won; "" (default StringValue) -> someone else did.
      const claim = await context.redis.set(
        REDIS_KEYS.compliant(postId),
        JSON.stringify({ timestamp: Date.now() }),
        { nx: true }
      );
      if (claim) {
        await context.redis.incrBy(REDIS_KEYS.statsOrganic, 1);
      }
      await context.redis.del(REDIS_KEYS.pending(postId));
      return;
    }

    // decision.kind === 'post_nudge'. Build a single combined comment that
    // includes the auto-draft (if available) rather than posting two separate
    // comments -- keeps the OP's inbox clean and the nudge self-contained.
    let commentText = renderNudge(minLength, settings.nudgeMessage as string | undefined);

    const enableAutoDraft = settings.enableAutoDraft ?? DEFAULTS.enableAutoDraft;
    const apiKey = settings.geminiApiKey as string;

    if (!enableAutoDraft) {
      console.log('Auto-draft is disabled in settings');
    } else if (!apiKey) {
      console.warn('Auto-draft enabled but geminiApiKey is not set. Set it via: devvit settings set geminiApiKey');
    } else if (!post.url) {
      console.warn('Auto-draft enabled but post has no URL');
    } else {
      console.log(`Generating alt-text for image: ${post.url}`);
      const draft = await generateAltText(post.url, apiKey);
      if (draft) {
        commentText += '\n\n' + renderAutoDraft(draft);
        await context.redis.incrBy(REDIS_KEYS.statsAutoDrafts, 1);
        console.log('Auto-draft included in nudge comment');
      } else {
        console.error('Auto-draft generation returned no result');
      }
    }

    const nudgeComment = await context.reddit.submitComment({
      id: postId,
      text: commentText,
    });

    await context.redis.set(REDIS_KEYS.nudgeComment(postId), nudgeComment.id);

    const enableFlair = settings.enableFlair ?? DEFAULTS.enableFlair;
    if (enableFlair) {
      const flairText = (settings.nonComplianceFlairText as string) || DEFAULTS.nonComplianceFlairText;
      await context.reddit.setPostFlair({
        subredditName: post.subredditName,
        postId,
        text: flairText,
      });
    }

    await context.redis.del(REDIS_KEYS.pending(postId));
    await context.redis.set(
      REDIS_KEYS.nudged(postId),
      JSON.stringify({ timestamp: Date.now(), nudgeCommentId: nudgeComment.id, flairApplied: !!enableFlair })
    );
    await context.redis.zAdd(REDIS_KEYS.missingQueue, { member: postId, score: Date.now() });
    await context.redis.incrBy(REDIS_KEYS.statsMissing, 1);
  },
});

// ─── PostUpdate Trigger ──────────────────────────────────────────────────────

Devvit.addTrigger({
  event: 'PostUpdate',
  onEvent: async (event, context) => {
    const postId = event.post?.id;
    if (!postId) return;

    const pendingData = await context.redis.get(REDIS_KEYS.pending(postId));
    const nudgedData = await context.redis.get(REDIS_KEYS.nudged(postId));

    if (!pendingData && !nudgedData) return;

    const post = await context.reddit.getPostById(postId);
    const settings = await context.settings.getAll();
    const minLength = (settings.minDescriptionLength as number) ?? DEFAULTS.minDescriptionLength;

    if (!hasDescription(post, minLength)) return;

    // Atomic claim: only one concurrent runner wins. Devvit's redis.set
    // resolves to a proto StringValue whose `value` field defaults to "" --
    // so a successful SET returns the stored value ("OK"-equivalent) and a
    // failed NX returns "". `if (!claim)` is a falsy check on that string.
    // If Devvit ever changes that contract, both PostUpdate and the
    // scheduler regress to double-counting; verify in playtest by firing
    // two PostUpdate events for the same postId and checking statsNudged
    // increments by exactly 1.
    const claim = await context.redis.set(
      REDIS_KEYS.compliant(postId),
      JSON.stringify({ timestamp: Date.now() }),
      { nx: true }
    );
    if (!claim) return;

    await context.redis.del(REDIS_KEYS.pending(postId));
    await context.redis.del(REDIS_KEYS.nudged(postId));
    await context.redis.zRem(REDIS_KEYS.missingQueue, [postId]);

    if (nudgedData) {
      await context.redis.incrBy(REDIS_KEYS.statsNudged, 1);

      // Floor statsMissing at 0: the counter can drift below state when the
      // app upgrades over existing nudged posts or when set() partial-fails.
      const newMissing = await context.redis.incrBy(REDIS_KEYS.statsMissing, -1);
      if (newMissing < 0) {
        await context.redis.set(REDIS_KEYS.statsMissing, '0');
      }

      const parsed = JSON.parse(nudgedData);
      if (parsed.flairApplied) {
        await context.reddit.removePostFlair(post.subredditName, postId);
      }

      const nudgeCommentId = await context.redis.get(REDIS_KEYS.nudgeComment(postId));
      if (nudgeCommentId) {
        try {
          const comment = await context.reddit.getCommentById(nudgeCommentId);
          await comment.edit({
            text: 'Description added. Screen reader users can now read this post.\n\n-- AltText Guardian',
          });
        } catch {
          // Comment may have been deleted
        }
        await context.redis.del(REDIS_KEYS.nudgeComment(postId));
      }
    }
  },
});

// ─── Mod Menu: Dashboard ─────────────────────────────────────────────────────

Devvit.addMenuItem({
  label: 'AltText Guardian: Dashboard',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const [total, organic, nudged, missing, autoDrafts] = await Promise.all([
      context.redis.get(REDIS_KEYS.statsTotal),
      context.redis.get(REDIS_KEYS.statsOrganic),
      context.redis.get(REDIS_KEYS.statsNudged),
      context.redis.get(REDIS_KEYS.statsMissing),
      context.redis.get(REDIS_KEYS.statsAutoDrafts),
    ]);

    const stats = [
      `**AltText Guardian Stats**`,
      ``,
      `| Metric | Count |`,
      `|--------|-------|`,
      `| Total image posts processed | ${total ?? '0'} |`,
      `| Posts with descriptions (organic) | ${organic ?? '0'} |`,
      `| Descriptions added after nudge | ${nudged ?? '0'} |`,
      `| Posts still missing descriptions | ${missing ?? '0'} |`,
      `| Auto-drafts generated | ${autoDrafts ?? '0'} |`,
    ].join('\n');

    context.ui.showToast(stats);
  },
});

// ─── Mod Menu: Missing Descriptions Queue ────────────────────────────────────

Devvit.addMenuItem({
  label: 'AltText Guardian: Missing Descriptions',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    // Get posts from last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const postIds = await context.redis.zRange(REDIS_KEYS.missingQueue, sevenDaysAgo, Date.now(), {
      by: 'score',
    });

    if (postIds.length === 0) {
      context.ui.showToast('No posts currently missing descriptions. Great job! 🎉');
      return;
    }

    const lines = [`**Posts Missing Descriptions (last 7 days): ${postIds.length}**`, ''];
    for (const entry of postIds.slice(0, 25)) {
      try {
        const post = await context.reddit.getPostById(entry.member);
        lines.push(`• [${post.title}](${post.permalink})`);
      } catch {
        lines.push(`• Post ${entry.member} (may have been deleted)`);
      }
    }

    if (postIds.length > 25) {
      lines.push(`\n...and ${postIds.length - 25} more`);
    }

    context.ui.showToast(lines.join('\n'));
  },
});

// ─── Mod Menu: Check Post Status ─────────────────────────────────────────────

Devvit.addMenuItem({
  label: 'Check Alt-Text Status',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const postId = event.targetId;

    const [pending, nudged, compliant] = await Promise.all([
      context.redis.get(REDIS_KEYS.pending(postId)),
      context.redis.get(REDIS_KEYS.nudged(postId)),
      context.redis.get(REDIS_KEYS.compliant(postId)),
    ]);

    let status: string;
    if (compliant) {
      status = '✅ Compliant - This post has a description.';
    } else if (nudged) {
      status = '⚠️ Nudged - OP was reminded but hasn\'t added a description yet.';
    } else if (pending) {
      status = '⏳ Pending - Grace period active, waiting for OP to add a description.';
    } else {
      // Check if it's even an image post
      const post = await context.reddit.getPostById(postId);
      if (isImagePost(post)) {
        status = '❓ Not tracked - This image post was submitted before AltText Guardian was installed.';
      } else {
        status = 'ℹ️ Not an image post - No alt-text required.';
      }
    }

    context.ui.showToast(status);
  },
});

export default Devvit;
