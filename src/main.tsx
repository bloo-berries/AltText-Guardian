import { Devvit } from '@devvit/public-api';
import { DEFAULTS, REDIS_KEYS, NUDGE_TEMPLATE, AUTO_DRAFT_TEMPLATE } from './constants.js';
import { isImagePost, hasDescription } from './imageDetection.js';
import { generateAltText } from './visionApi.js';

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

    const post = await context.reddit.getPostById(postId);
    const settings = await context.settings.getAll();
    const minLength = (settings.minDescriptionLength as number) ?? DEFAULTS.minDescriptionLength;

    // Re-check - OP may have added a description during grace period
    if (hasDescription(post, minLength)) {
      await context.redis.del(REDIS_KEYS.pending(postId));
      await context.redis.set(REDIS_KEYS.compliant(postId), JSON.stringify({ timestamp: Date.now() }));
      await context.redis.incrBy(REDIS_KEYS.statsOrganic, 1);
      return;
    }

    // Post nudge comment
    const nudgeTemplate = (settings.nudgeMessage as string) || NUDGE_TEMPLATE;
    const nudgeText = nudgeTemplate.replace('{minLength}', String(minLength));

    const nudgeComment = await context.reddit.submitComment({
      id: postId,
      text: nudgeText,
    });

    // Store nudge comment ID for potential cleanup
    await context.redis.set(REDIS_KEYS.nudgeComment(postId), nudgeComment.id);

    // Auto-draft if enabled
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
        const draftText = AUTO_DRAFT_TEMPLATE.replace('{draft}', draft);
        await context.reddit.submitComment({
          id: nudgeComment.id,
          text: draftText,
        });
        await context.redis.incrBy(REDIS_KEYS.statsAutoDrafts, 1);
        console.log('Auto-draft comment posted successfully');
      } else {
        console.error('Auto-draft generation returned no result');
      }
    }

    // Apply flair if enabled
    const enableFlair = settings.enableFlair ?? DEFAULTS.enableFlair;
    if (enableFlair) {
      const flairText = (settings.nonComplianceFlairText as string) || DEFAULTS.nonComplianceFlairText;
      await context.reddit.setPostFlair({
        subredditName: post.subredditName,
        postId,
        text: flairText,
      });
    }

    // Update Redis state
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

    // Check if we're tracking this post
    const pendingData = await context.redis.get(REDIS_KEYS.pending(postId));
    const nudgedData = await context.redis.get(REDIS_KEYS.nudged(postId));

    if (!pendingData && !nudgedData) return;

    const post = await context.reddit.getPostById(postId);
    const settings = await context.settings.getAll();
    const minLength = (settings.minDescriptionLength as number) ?? DEFAULTS.minDescriptionLength;

    if (!hasDescription(post, minLength)) return;

    // Description has been added - mark as compliant
    await context.redis.del(REDIS_KEYS.pending(postId));
    await context.redis.del(REDIS_KEYS.nudged(postId));
    await context.redis.set(REDIS_KEYS.compliant(postId), JSON.stringify({ timestamp: Date.now() }));
    await context.redis.zRem(REDIS_KEYS.missingQueue, [postId]);

    if (nudgedData) {
      // Description was added after our nudge
      await context.redis.incrBy(REDIS_KEYS.statsNudged, 1);
      await context.redis.incrBy(REDIS_KEYS.statsMissing, -1);

      // Remove flair if it was applied
      const parsed = JSON.parse(nudgedData);
      if (parsed.flairApplied) {
        await context.reddit.removePostFlair(post.subredditName, postId);
      }

      // Edit nudge comment to acknowledge compliance
      const nudgeCommentId = await context.redis.get(REDIS_KEYS.nudgeComment(postId));
      if (nudgeCommentId) {
        try {
          const comment = await context.reddit.getCommentById(nudgeCommentId);
          await comment.edit({
            text: `✅ Thank you for adding a description! Your post is now more accessible.\n\n*— AltText Guardian*`,
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
