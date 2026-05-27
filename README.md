# AltText Guardian

Image-heavy subs (r/aww, r/Art, r/photography, r/OldSchoolCool) are effectively unusable for screen-reader users because almost no posts have descriptions. AltText Guardian detects image submissions lacking post description, generates auto-reply alt-text for the OP using a vision model. Mods get an automatically generated alt-text description in their auto-reply mod bot using a computer-vision text render!

## Vision Model

AltText Guardian uses **[Google Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models#gemini-2.5-flash-lite)** for auto-draft alt-text generation. The image bytes are fetched by the app, base64-encoded, and sent to Gemini via `inline_data` for direct multimodal analysis.

The app owner sets a free [Google AI Studio API key](https://aistudio.google.com/apikey) once via the CLI to enable auto-draft descriptions across all installations.

## Features

- **Image detection** — Identifies image and gallery posts (i.redd.it, imgur, Reddit galleries, URLs with image extensions including those with query strings)
- **Grace period** — Configurable window (default: 2 minutes) for OP to add a description before nudging
- **Nudge comment** — Posts a terse, accessibility-focused reminder asking OP to add a description; the auto-draft (when enabled) is appended to the same comment
- **Auto-draft alt-text** — Optionally generates a suggested description with Google's Gemini 2.5 Flash-Lite; output is sanitized to strip Markdown links, image embeds, and mentions
- **Idempotent state machine** — Scheduler holds a TTL lock and PostUpdate uses NX-claims so retries and concurrent edits don't double-nudge or double-count
- **Compliance tracking** — Stats (organic descriptions, post-nudge additions, still missing) in Redis
- **Mod queue** — Menu items for a dashboard and a list of non-compliant posts
- **Flair support** — Optionally flairs posts missing descriptions

## Configuration

Mods can configure these settings per-subreddit after installing:

| Setting                | Default             | Description                                                                    |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------ |
| Grace period           | 2 min               | Time before nudging OP                                                         |
| Min description length | 50 chars            | Minimum characters for a valid description                                     |
| Enable auto-draft      | true                | Generate alt-text suggestions with Gemini 2.5 Flash-Lite                       |
| Enable flair           | false               | Flair non-compliant posts                                                      |
| Flair text             | "Needs Description" | Text for non-compliance flair                                                  |
| API key                | —                   | Google Gemini API key; set via `devvit settings set geminiApiKey` (app secret) |

## Project Structure

```
src/
├── main.tsx            # Entry point: config, triggers, scheduler, menu items
├── constants.ts        # Defaults, templates, Redis keys, types
├── imageDetection.ts   # isImagePost, hasDescription
├── templating.ts       # Comment template rendering + Gemini-output sanitizer
├── scheduler.ts        # Pure decision logic for the checkDescription job
└── visionApi.ts        # Google Gemini 2.5 Flash-Lite integration

tests/                  # Vitest + fast-check property tests (outside src/ so
                        # Devvit's bundler ignores them)
```

## Development

```bash
npm install
npm run build                         # Type-check (tsc --noEmit)
npm test                              # Run unit + property tests
npm run test:watch                    # Watch mode
npx devvit upload                     # Deploy to Reddit
npx devvit settings set geminiApiKey  # Set Google Gemini API key (one-time, app-scoped)
```
