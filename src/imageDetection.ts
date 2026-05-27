import { Post } from '@devvit/public-api';
import { IMAGE_DOMAINS, IMAGE_EXTENSIONS } from './constants.js';

/**
 * Detect if a post is an image or gallery post.
 */
export function isImagePost(post: Post): boolean {
  const url = post.url.toLowerCase();

  // Check for Reddit gallery posts
  if (url.includes('/gallery/')) {
    return true;
  }

  // Parse once; reuse for both domain and extension checks so query strings
  // and fragments do not defeat the extension match.
  let pathname: string | null = null;
  try {
    const parsedUrl = new URL(url);
    if (IMAGE_DOMAINS.some((domain) => parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`))) {
      return true;
    }
    pathname = parsedUrl.pathname;
  } catch {
    // URL parsing failed; fall back to raw-string match below
  }

  const haystack = pathname ?? url;
  if (IMAGE_EXTENSIONS.some((ext) => haystack.endsWith(ext))) {
    return true;
  }

  if (post.gallery && post.gallery.length > 0) {
    return true;
  }

  return false;
}

/**
 * Check if the post's OP has provided a description meeting the minimum length.
 *
 * Devvit's GalleryMedia type exposes only { status, url, height, width } -- no
 * per-image caption -- so we cannot include gallery captions here. Body is the
 * only OP-controlled text field the SDK surfaces.
 */
export function hasDescription(post: Post, minLength: number): boolean {
  const body = post.body ?? '';
  const trimmed = body.trim();
  return trimmed.length >= minLength;
}
