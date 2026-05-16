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

  // Check URL against known image hosting domains
  try {
    const parsedUrl = new URL(url);
    if (IMAGE_DOMAINS.some((domain) => parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`))) {
      return true;
    }
  } catch {
    // URL parsing failed, continue with other checks
  }

  // Check for image file extensions in URL
  if (IMAGE_EXTENSIONS.some((ext) => url.endsWith(ext))) {
    return true;
  }

  // Check if post has gallery media
  if (post.gallery && post.gallery.length > 0) {
    return true;
  }

  return false;
}

/**
 * Check if the post's OP has provided a description meeting the minimum length.
 */
export function hasDescription(post: Post, minLength: number): boolean {
  const body = post.body ?? '';
  const trimmed = body.trim();
  return trimmed.length >= minLength;
}
