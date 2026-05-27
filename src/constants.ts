/** Default settings values */
export const DEFAULTS = {
  gracePeriodMinutes: 2,
  minDescriptionLength: 50,
  enableAutoDraft: true,
  enableFlair: false,
  nonComplianceFlairText: 'Needs Description',
} as const;

/** Redis key patterns */
export const REDIS_KEYS = {
  pending: (postId: string) => `pending:${postId}`,
  nudged: (postId: string) => `nudged:${postId}`,
  compliant: (postId: string) => `compliant:${postId}`,
  nudgeComment: (postId: string) => `nudge_comment:${postId}`,
  /** TTL lock to make the checkDescription scheduler retry-safe */
  scheduleLock: (postId: string) => `schedule_lock:${postId}`,
  /** Sorted set of non-compliant post IDs by timestamp */
  missingQueue: 'missing_queue',
  /** Stats counters */
  statsTotal: 'stats:total_image_posts',
  statsOrganic: 'stats:organic_descriptions',
  statsNudged: 'stats:descriptions_after_nudge',
  statsMissing: 'stats:still_missing',
  statsAutoDrafts: 'stats:auto_drafts',
} as const;

/** Nudge comment template */
export const NUDGE_TEMPLATE = `Hey! This post appears to contain an image but no description was found.

Text descriptions make posts accessible to Redditors using screen readers, and improves everyone's experience. This is an automated accessibility feature from AltText Guardian.

Here's a generated description of OP's image:`;

/** Auto-draft comment template */
export const AUTO_DRAFT_TEMPLATE = `{draft}

Feel free to write your own description, or you can always rely on AltText Guardian!`;

/** Image hosting domains to detect */
export const IMAGE_DOMAINS = [
  'i.redd.it',
  'i.imgur.com',
  'imgur.com',
  'preview.redd.it',
  'external-preview.redd.it',
] as const;

/** Image file extensions */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'] as const;

/** Post tracking state */
export type PostState = 'pending' | 'nudged' | 'compliant';

export interface PostTrackingData {
  postId: string;
  timestamp: number;
  state: PostState;
  nudgeCommentId?: string;
  flairApplied?: boolean;
}
