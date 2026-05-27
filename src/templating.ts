import { AUTO_DRAFT_TEMPLATE, NUDGE_TEMPLATE } from './constants.js';

/**
 * Substitute a placeholder with arbitrary content. Unlike
 * String.prototype.replace(string, string), this does not interpret
 * $&, $$, $`, $' in the replacement.
 */
function substitute(template: string, placeholder: string, value: string): string {
  const idx = template.indexOf(placeholder);
  if (idx < 0) return template;
  return template.slice(0, idx) + value + template.slice(idx + placeholder.length);
}

/**
 * The auto-draft text comes from a vision model fed an attacker-controlled
 * image, so it must be treated as untrusted Markdown. We strip the patterns
 * that would let the model post a clickable link, embed an image, ping
 * users, or smuggle a horizontal rule that visually escapes our template.
 */
export function sanitizeDraft(text: string): string {
  return (
    text
      // Image embeds: drop entirely; they would render in the comment.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      // Link syntax: keep only the visible label.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Bare URLs: Reddit auto-links them, so remove the whole token.
      .replace(/https?:\/\/\S+/gi, '[link removed]')
      // Subreddit / user mentions: backslash-escape so they render literal.
      .replace(/(^|\s)([ur])\/([A-Za-z0-9_-]+)/g, '$1\\$2/$3')
      // Markdown horizontal rules: prevent breaking out of our template.
      .replace(/^[-*_]{3,}\s*$/gm, '...')
  );
}

export function renderNudge(minLength: number, customTemplate?: string): string {
  const template = customTemplate && customTemplate.length > 0 ? customTemplate : NUDGE_TEMPLATE;
  return substitute(template, '{minLength}', String(minLength));
}

export function renderAutoDraft(draft: string): string {
  return substitute(AUTO_DRAFT_TEMPLATE, '{draft}', sanitizeDraft(draft));
}
