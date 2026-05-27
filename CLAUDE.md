# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Devvit (Reddit Developer Platform) app that detects image posts missing a description, nudges the OP after a grace period, optionally generates a draft alt-text via Google Gemini 2.0 Flash (`gemini-2.0-flash:generateContent` with base64 `inline_data`), and tracks compliance in Redis. Single-process serverless app — no local server, no test suite.

## Commands

```bash
npm install
npm run build                              # type-check only (tsc --noEmit), no emit
npm run typecheck                          # alias of build
npx devvit upload                          # bundle + push to Reddit (auth required)
npx devvit settings set geminiApiKey       # set app-scoped secret (one-time, per app)
npx devvit playtest <subreddit>            # live-reload dev cycle against a test sub
npx devvit logs <subreddit>                # tail logs from a deployed install
```

There is no test runner, no linter, no formatter configured. `tsc --noEmit` is the only check.

## Architecture

**Runtime model.** Devvit code runs inside Reddit's sandboxed worker, not Node. It cannot import Node built-ins, cannot keep in-memory state across invocations, and cannot reach the network except for domains declared in `Devvit.configure({ http: { domains: [...] } })` (`src/main.tsx:9`). Any new outbound host must be added there or fetches will be blocked.

**Event-driven state machine.** A post moves through `pending -> nudged -> compliant` (see `PostState` in `src/constants.ts`). Three handlers in `src/main.tsx` drive transitions:

1. `PostSubmit` trigger — for new image posts without a description, writes `pending:<postId>` and schedules a `checkDescription` job at `now + gracePeriodMinutes`.
2. `checkDescription` scheduler job — re-fetches the post, re-checks description; if still missing, posts the nudge comment, optionally calls the vision API to post a draft as a reply, optionally sets flair, and moves state to `nudged:<postId>` + adds to the `missing_queue` sorted set.
3. `PostUpdate` trigger — fires when OP edits; if the description now passes, deletes pending/nudged keys, removes flair, edits the nudge comment to a thank-you, and bumps the appropriate stats counter.

All Redis keys are constructed via `REDIS_KEYS` in `src/constants.ts` — do not inline string keys elsewhere or the state machine will desynchronize.

**Stats vs state.** Per-post keys (`pending:`, `nudged:`, `compliant:`, `nudge_comment:`) are the source of truth for what to do next. The `stats:*` counters and `missing_queue` sorted set are derived views read by the mod menu items; they can drift if a transition path is changed without updating both sides.

**Settings scopes matter.** `geminiApiKey` is `scope: 'app'` and `isSecret: true` — it is set once by the app owner via the CLI and shared across all installs. Everything else is `scope: 'installation'` and configured per-subreddit by mods. Don't change a setting's scope without understanding the upgrade implications.

**Vision flow.** `generateAltText(imageUrl, apiKey)` in `src/visionApi.ts` fetches the image bytes itself, base64-encodes them, and posts them inline to Gemini — it does not hand Gemini a URL. This means the image host (`i.redd.it`, `i.imgur.com`, `preview.redd.it`, etc.) must be in the `http.domains` allowlist in addition to `generativelanguage.googleapis.com`. The function returns `null` on any error and the caller treats `null` as a non-fatal skip.

## Conventions

- `.js` extensions on relative imports (`./constants.js`) are required — the project uses `"type": "module"` with `"moduleResolution": "bundler"` and Devvit's bundler resolves them. Don't strip them.
- Strict TS is on (`tsconfig.json`). The `jsxImportSource` is `@devvit/public-api`, not React.
- Reddit/Redis calls inside triggers/jobs should be defensive about deleted posts and comments — `context.reddit.getPostById` and `getCommentById` will throw if the entity is gone. Existing handlers wrap edits in `try/catch` for this reason.
