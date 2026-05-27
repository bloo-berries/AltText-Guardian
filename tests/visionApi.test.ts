import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  arrayBufferToBase64,
  isImageWithinLimit,
  MAX_IMAGE_BYTES,
  mimeTypeFromUrl,
} from '../src/visionApi.js';

describe('arrayBufferToBase64', () => {
  test('encodes empty buffer to empty string', () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe('');
  });

  test('encodes known bytes', () => {
    const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    expect(arrayBufferToBase64(bytes.buffer)).toBe('SGVsbG8=');
  });

  test('property: roundtrip atob(arrayBufferToBase64(buf)) is byte-equal', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 4096 }), (bytes) => {
        const encoded = arrayBufferToBase64(bytes.buffer);
        const decoded = atob(encoded);
        if (decoded.length !== bytes.length) return false;
        for (let i = 0; i < bytes.length; i++) {
          if (decoded.charCodeAt(i) !== bytes[i]) return false;
        }
        return true;
      }),
      { numRuns: 100, seed: 13 }
    );
  });
});

describe('isImageWithinLimit', () => {
  test('rejects zero-length buffers', () => {
    expect(isImageWithinLimit(0)).toBe(false);
  });

  test('accepts buffers up to and including the limit', () => {
    expect(isImageWithinLimit(1)).toBe(true);
    expect(isImageWithinLimit(MAX_IMAGE_BYTES)).toBe(true);
  });

  test('rejects buffers over the limit', () => {
    expect(isImageWithinLimit(MAX_IMAGE_BYTES + 1)).toBe(false);
  });

  test('honors a caller-supplied override', () => {
    expect(isImageWithinLimit(2048, 1024)).toBe(false);
    expect(isImageWithinLimit(512, 1024)).toBe(true);
  });
});

describe('mimeTypeFromUrl', () => {
  test.each([
    ['https://x.com/a.jpg', 'image/jpeg'],
    ['https://x.com/a.jpeg', 'image/jpeg'],
    ['https://x.com/a.png', 'image/png'],
    ['https://x.com/a.gif', 'image/gif'],
    ['https://x.com/a.webp', 'image/webp'],
    ['https://x.com/a.bmp', 'image/bmp'],
    ['https://x.com/a.tiff', 'image/tiff'],
  ])('%s -> %s', (url, expected) => {
    expect(mimeTypeFromUrl(url)).toBe(expected);
  });

  test('unknown extension returns null', () => {
    expect(mimeTypeFromUrl('https://x.com/a.svg')).toBe(null);
  });

  test('regression: query string does not block detection', () => {
    expect(mimeTypeFromUrl('https://x.com/a.jpg?w=100')).toBe('image/jpeg');
  });

  test('regression: fragment does not block detection', () => {
    expect(mimeTypeFromUrl('https://x.com/a.png#section')).toBe('image/png');
  });

  test('regression: uppercase extension resolves', () => {
    expect(mimeTypeFromUrl('https://x.com/A.PNG')).toBe('image/png');
  });
});
