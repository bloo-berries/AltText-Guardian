/** Default settings values */
export const DEFAULTS = {
  gracePeriodMinutes: 10,
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
export const NUDGE_TEMPLATE = `👋 Hi there! This post appears to contain an image but no description was found.

**Adding a text description makes your post accessible to people using screen readers** and improves the experience for everyone.

Please edit your post to include a description of the image (at least {minLength} characters). You can add it to the post body.

*This is an automated accessibility reminder from AltText Guardian.*`;

/** Auto-draft comment template */
export const AUTO_DRAFT_TEMPLATE = `Here's a suggested description for your image:

---

{draft}

---

Feel free to copy this into your post body (edit your post), or write your own description. Any description helps! 🙏`;

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
