import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { Post } from '@devvit/public-api';
import { hasDescription, isImagePost } from '../src/imageDetection.js';
import { IMAGE_EXTENSIONS } from '../src/constants.js';

function makePost(overrides: Partial<{ url: string; body: string; gallery: unknown[] }>): Post {
  return {
    url: overrides.url ?? 'https://reddit.com/r/x/comments/abc',
    body: overrides.body ?? '',
    gallery: overrides.gallery,
  } as unknown as Post;
}

describe('hasDescription', () => {
  test('returns true when trimmed body meets minLength', () => {
    const post = makePost({ body: 'x'.repeat(60) });
    expect(hasDescription(post, 50)).toBe(true);
  });

  test('returns false when body is shorter than minLength', () => {
    expect(hasDescription(makePost({ body: 'short' }), 50)).toBe(false);
  });

  test('whitespace-only body is treated as empty', () => {
    expect(hasDescription(makePost({ body: '   \n\t   ' }), 1)).toBe(false);
  });

  test('handles missing body via Post.body undefined', () => {
    expect(hasDescription({ url: '', body: undefined } as unknown as Post, 1)).toBe(false);
  });

  test('minLength=0 accepts any body, even empty', () => {
    expect(hasDescription(makePost({ body: '' }), 0)).toBe(true);
  });

  test('unicode whitespace is trimmed (NBSP, line separator)', () => {
    const body = '  hello world  ';
    expect(hasDescription(makePost({ body }), 11)).toBe(true);
    expect(hasDescription(makePost({ body }), 12)).toBe(false);
  });

  test('property: hasDescription(body, n) is invariant under surrounding whitespace', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.integer({ min: 0, max: 100 }),
        (body, minLength) => {
          const padded = `   \n\t${body}\t\n   `;
          return (
            hasDescription(makePost({ body }), minLength) ===
            hasDescription(makePost({ body: padded }), minLength)
          );
        }
      ),
      { numRuns: 100, seed: 21 }
    );
  });
});

describe('isImagePost', () => {
  test('detects i.redd.it URL', () => {
    const post = makePost({ url: 'https://i.redd.it/abc.jpg' });
    expect(isImagePost(post)).toBe(true);
  });

  test('detects gallery URL', () => {
    const post = makePost({ url: 'https://reddit.com/gallery/abc' });
    expect(isImagePost(post)).toBe(true);
  });

  test('regression: image URL with query string is detected', () => {
    const post = makePost({ url: 'https://cdn.example.com/photo.jpg?w=800&h=600' });
    expect(isImagePost(post)).toBe(true);
  });

  test('regression: image URL with fragment is detected', () => {
    const post = makePost({ url: 'https://cdn.example.com/photo.png#section' });
    expect(isImagePost(post)).toBe(true);
  });

  test('non-image URL stays false', () => {
    const post = makePost({ url: 'https://example.com/article' });
    expect(isImagePost(post)).toBe(false);
  });

  test('property: any URL ending its pathname with an image extension is detected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...IMAGE_EXTENSIONS),
        fc.webFragments(),
        (ext, fragment) => {
          const url = `https://cdn.example.com/photo${ext}?cache=1${fragment ? '#' + fragment : ''}`;
          return isImagePost(makePost({ url })) === true;
        }
      ),
      { numRuns: 100, seed: 7 }
    );
  });
});
