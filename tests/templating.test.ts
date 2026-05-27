import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { renderAutoDraft, renderNudge } from '../src/templating.js';

describe('renderAutoDraft', () => {
  test('happy path: inserts draft text', () => {
    expect(renderAutoDraft('a sleeping cat')).toContain('a sleeping cat');
  });

  test('regression: $-sequences must be inserted literally', () => {
    // String.prototype.replace(string, string) expands $&, $$, $`, $'
    // even when the pattern is a literal string -- only $n is left alone.
    // Sanitization may rewrite the text but the $-sequences should survive.
    const malicious = "ends with $$ and $& and $` and $'";
    const out = renderAutoDraft(malicious);
    for (const seq of ['$$', '$&', '$`', "$'"]) {
      expect(out).toContain(seq);
    }
  });

  test('strips Markdown link syntax, preserving visible text', () => {
    const out = renderAutoDraft('cat with [click here](https://evil.example) eyes');
    expect(out).toContain('click here');
    expect(out).toContain('cat with');
    expect(out).toContain('eyes');
    expect(out).not.toContain('https://evil.example');
    expect(out).not.toMatch(/\]\(/);
  });

  test('drops Markdown image embeds entirely', () => {
    const out = renderAutoDraft('see ![alt text](https://tracker.example/pixel.gif) here');
    expect(out).not.toContain('tracker.example');
    expect(out).not.toMatch(/!\[/);
  });

  test('neutralizes bare URLs so Reddit cannot auto-link them', () => {
    const out = renderAutoDraft('visit https://evil.example/path now');
    expect(out).not.toContain('https://evil.example');
  });

  test('escapes u/ and r/ mentions to prevent brigading', () => {
    const out = renderAutoDraft('praise u/spammer and r/badsub');
    expect(out).not.toMatch(/(^|\s)u\/spammer/);
    expect(out).not.toMatch(/(^|\s)r\/badsub/);
  });

  test('property: rendered output never contains an unescaped Markdown link', () => {
    fc.assert(
      fc.property(fc.string(), (draft) => {
        const rendered = renderAutoDraft(draft);
        // No [text](url) and no ![alt](url) survive after sanitization.
        return !/!?\[[^\]]*\]\([^)]*\)/.test(rendered.replace(
          // The template itself contains no Markdown links, so this is purely
          // a check that user-controlled content cannot smuggle them in.
          '',
          ''
        ));
      }),
      { numRuns: 200, seed: 88 }
    );
  });
});

describe('renderNudge', () => {
  test('substitutes {minLength}', () => {
    expect(renderNudge(50)).toContain('50');
  });

  test('uses custom template when non-empty', () => {
    expect(renderNudge(25, 'Custom: at least {minLength}')).toBe('Custom: at least 25');
  });

  test('falls back to default template on empty custom', () => {
    expect(renderNudge(40, '')).toContain('40');
  });
});
