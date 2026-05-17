# AltText Guardian

Image-heavy subs (r/aww, r/Art, r/photography, r/OldSchoolCool) are effectively unusable for screen-reader users because almost no posts have descriptions. AltText Guardian detects image submissions lacking a description in the post body, prompts the OP via auto-comment, optionally generates a draft alt-text using a vision model for the OP to approve and post as a top-level comment, and tracks compliance over time. Mods get a queue view of "images missing descriptions."

## Open Source Vision Model

AltText Guardian uses **[Llama 4 Scout 17B](https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct)**, an open-source vision-language model by Meta (Llama 4 Community License), accessed through [Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers/index). This means:

- **No paid API required** — Hugging Face offers a free tier for inference
- **Open-source model** — The underlying model weights are freely available and auditable
- **Vision-native** — Llama 4 Scout is a multimodal VLM that natively processes images to generate descriptions
- **Privacy-conscious** — No vendor lock-in to closed commercial APIs

The app owner sets a free [Hugging Face token](https://huggingface.co/settings/tokens) once via the CLI to enable auto-draft descriptions across all installations.

## Features

- **Image detection** — Automatically identifies image and gallery posts (i.redd.it, imgur, Reddit galleries, etc.)
- **Grace period** — Gives OP a configurable window (default: 10 minutes) to add a description before nudging
- **Friendly nudge** — Posts an accessibility-focused comment reminding OP to add a description
- **Auto-draft alt-text** — Optionally generates a suggested description using an open-source vision model via Hugging Face
- **Compliance tracking** — Tracks stats (organic descriptions, post-nudge additions, still missing) in Redis
- **Mod queue** — Menu items to view a dashboard and list of non-compliant posts
- **Flair support** — Optionally flairs posts that are missing descriptions

## Configuration

Mods can configure these settings per-subreddit after installing:

| Setting | Default | Description |
|---------|---------|-------------|
| Grace period | 10 min | Time before nudging OP |
| Min description length | 50 chars | Minimum characters for a valid description |
| Enable auto-draft | true | Generate alt-text suggestions with open-source vision model |
| Enable flair | false | Flair non-compliant posts |
| Flair text | "Needs Description" | Text for non-compliance flair |
| Hugging Face API token | — | App secret; set via `devvit settings set hfApiToken` (not per-subreddit) |

## Project Structure

```
src/
├── main.tsx            # Entry point: config, triggers, scheduler, menu items
├── constants.ts        # Defaults, templates, Redis keys, types
├── imageDetection.ts   # Image post detection and description checking
└── visionApi.ts        # Hugging Face open-source vision model integration
```

## Development

```bash
npm install
npm run build       # Type-check (tsc --noEmit)
npx devvit upload   # Deploy to Reddit
npx devvit settings set hfApiToken   # Set Hugging Face token (app secret)
```
