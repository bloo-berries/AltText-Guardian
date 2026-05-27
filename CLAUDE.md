# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Devvit (Reddit Developer Platform) app that detects image posts missing a description, nudges the OP after a grace period, optionally generates a draft alt-text via Google Gemini 2.5 Flash-Lite (`gemini-2.5-flash-lite:generateContent` with base64 `inline_data`), and tracks compliance in Redis. Single-process serverless app — no local server.

## Commands

```bash
npm install
npm run build                              # type-check only (tsc --noEmit), no emit
npm run typecheck                          # alias of build
npm test                                   # vitest run (unit + property-based)
npm run test:watch                         # vitest watch mode
npx devvit upload                          # bundle + push to Reddit (auth required)
npx devvit settings set geminiApiKey       # set app-scoped secret (one-time, per app)
npx devvit playtest <subreddit>            # live-reload dev cycle against a test sub
npx devvit logs <subreddit>                # tail logs from a deployed install
```

Tests live in `tests/` (outside `src/` so Devvit's bundler and `tsc --noEmit` skip them). Vitest is the runner; `fast-check` supplies property-based generators. No linter or formatter is configured.

## Architecture

**Runtime model.** Devvit code runs inside Reddit's sandboxed worker, not Node. It cannot import Node built-ins, cannot keep in-memory state across invocations, and cannot reach the network except for domains declared in `Devvit.configure({ http: { domains: [...] } })` (`src/main.tsx`). Any new outbound host must be added there or fetches will be blocked.

**Event-driven state machine.** A post moves through `pending -> nudged -> compliant` (see `PostState` in `src/constants.ts`). Three handlers in `src/main.tsx` drive transitions:

1. `PostSubmit` trigger — for new image posts without a description, writes `pending:<postId>` and schedules a `checkDescription` job at `now + gracePeriodMinutes`.
2. `checkDescription` scheduler job — re-fetches the post, runs `decideSchedulerAction` against the current Redis state, and either bails (lock held / already nudged / already compliant), marks the post compliant if OP added a description during the grace window, or posts the nudge comment (plus optional Gemini draft and flair) and moves state to `nudged:<postId>` + adds to the `missing_queue` sorted set.
3. `PostUpdate` trigger — fires when OP edits; if the description now passes, atomically claims `compliant:<postId>` via NX (bailing if another runner already won), deletes pending/nudged keys, removes flair, edits the nudge comment to a thank-you, and bumps the appropriate stats counter.

All Redis keys are constructed via `REDIS_KEYS` in `src/constants.ts` — do not inline string keys elsewhere or the state machine will desynchronize.

**Idempotency.** Both the scheduler and `PostUpdate` rely on `redis.set(..., { nx: true })` for their state transitions. Devvit's `redis.set` returns a proto `StringValue` whose `value` defaults to `""`, so a truthy result means "we won the NX" and falsy means "another runner already claimed it." The scheduler additionally acquires a TTL'd `schedule_lock:<postId>` at the top of every run (see `SCHEDULE_LOCK_TTL_MS` in `src/main.tsx`); this prevents Devvit's job retries from posting duplicate nudge comments or making duplicate Gemini calls.

**Stats vs state.** Per-post keys (`pending:`, `nudged:`, `compliant:`, `nudge_comment:`, `schedule_lock:`) are the source of truth. The `stats:*` counters and `missing_queue` sorted set are derived views read by the mod menu items; they can drift if a transition path is changed without updating both sides. `statsMissing` is decremented with a floor at 0 to absorb pre-existing drift.

**Settings scopes matter.** `geminiApiKey` is `scope: 'app'` and `isSecret: true` — it is set once by the app owner via the CLI and shared across all installs. Everything else is `scope: 'installation'` and configured per-subreddit by mods. Don't change a setting's scope without understanding the upgrade implications.

**Vision flow.** `generateAltText(imageUrl, apiKey)` in `src/visionApi.ts` fetches the image bytes itself, base64-encodes them, and posts them inline to Gemini — it does not hand Gemini a URL. This means the image host (`i.redd.it`, `i.imgur.com`, `preview.redd.it`, etc.) must be in the `http.domains` allowlist in addition to `generativelanguage.googleapis.com`. The function caps input at `MAX_IMAGE_BYTES` (10 MB) before encoding and returns `null` on any error; the caller treats `null` as a non-fatal skip.

**Vision output is untrusted.** Gemini sees attacker-controlled image content and can be prompt-injected into emitting links, image embeds, or instructions to readers. `sanitizeDraft` in `src/templating.ts` strips Markdown link/image syntax, neutralizes bare URLs, escapes `u/` and `r/` mentions, and collapses horizontal rules before substitution into `AUTO_DRAFT_TEMPLATE`. `VISION_PROMPT` in `src/visionApi.ts` also tells the model to emit plain prose and to describe (not obey) any instructions written in the image. `renderAutoDraft` is the only sanctioned writer — do not bypass it.

**Module layout.** Side effects (Redis, Reddit, scheduler) live in `src/main.tsx`. Pure logic is extracted into separate modules so it can be tested without Devvit context:

- `src/imageDetection.ts` — `isImagePost`, `hasDescription`
- `src/templating.ts` — `renderNudge`, `renderAutoDraft`, `sanitizeDraft`
- `src/scheduler.ts` — `decideSchedulerAction` (state → action mapping)
- `src/visionApi.ts` — `generateAltText` (network), plus `arrayBufferToBase64`, `mimeTypeFromUrl`, `isImageWithinLimit` (exported for testing)

When adding new behavior, prefer extracting the decision into a pure module here over inlining it in `main.tsx`.

## Conventions

- `.js` extensions on relative imports (`./constants.js`) are required — the project uses `"type": "module"` with `"moduleResolution": "bundler"` and Devvit's bundler resolves them. Don't strip them.
- Strict TS is on (`tsconfig.json`). The `jsxImportSource` is `@devvit/public-api`, not React.
- Reddit/Redis calls inside triggers/jobs should be defensive about deleted posts and comments — `context.reddit.getPostById` and `getCommentById` will throw if the entity is gone. Existing handlers wrap edits in `try/catch` for this reason.
- Devvit's `GalleryMedia` type exposes only `{ status, url, height, width }` — there is no SDK-surface for per-image captions, so `hasDescription` only inspects `post.body`.
- No emojis in user-facing strings (nudge/draft/thank-you templates) — see global project preference.
