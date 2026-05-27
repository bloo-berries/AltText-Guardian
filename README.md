# AltText Guardian

Image-heavy subs (r/aww, r/Art, r/photography, r/OldSchoolCool) are effectively unusable for screen-reader users because almost no posts have descriptions. AltText Guardian detects image submissions lacking a description in the post body, prompts the OP via auto-comment, optionally generates a draft alt-text using a vision model for the OP to approve and post as a top-level comment, and tracks compliance over time. Mods get a queue view of "images missing descriptions."

## Vision Model

AltText Guardian uses **[Google Gemini 2.0 Flash](https://ai.google.dev/gemini-api/docs/models#gemini-2.0-flash)** for auto-draft alt-text generation. The image bytes are fetched by the app, base64-encoded, and sent to Gemini via `inline_data` for direct multimodal analysis.

The app owner sets a free [Google AI Studio API key](https://aistudio.google.com/apikey) once via the CLI to enable auto-draft descriptions across all installations.

## Features

- **Image detection** — Automatically identifies image and gallery posts (i.redd.it, imgur, Reddit galleries, etc.)
- **Grace period** — Gives OP a configurable window (default: 10 minutes) to add a description before nudging
- **Friendly nudge** — Posts an accessibility-focused comment reminding OP to add a description
- **Auto-draft alt-text** — Optionally generates a suggested description using Google's Gemini 2.0 Flash vision model
- **Compliance tracking** — Tracks stats (organic descriptions, post-nudge additions, still missing) in Redis
- **Mod queue** — Menu items to view a dashboard and list of non-compliant posts
- **Flair support** — Optionally flairs posts that are missing descriptions

## Configuration

Mods can configure these settings per-subreddit after installing:

| Setting | Default | Description |
|---------|---------|-------------|
| Grace period | 10 min | Time before nudging OP |
| Min description length | 50 chars | Minimum characters for a valid description |
| Enable auto-draft | true | Generate alt-text suggestions with Gemini 2.0 Flash |
| Enable flair | false | Flair non-compliant posts |
| Flair text | "Needs Description" | Text for non-compliance flair |
| API key | — | Google Gemini API key; set via `devvit settings set geminiApiKey` (app secret) |

## Project Structure

```
src/
├── main.tsx            # Entry point: config, triggers, scheduler, menu items
├── constants.ts        # Defaults, templates, Redis keys, types
├── imageDetection.ts   # Image post detection and description checking
└── visionApi.ts        # Google Gemini 2.0 Flash vision model integration
```

## Development

```bash
npm install
npm run build       # Type-check (tsc --noEmit)
npx devvit upload   # Deploy to Reddit
npx devvit settings set geminiApiKey # Set Google Gemini API key (one-time, app-scoped)
```
