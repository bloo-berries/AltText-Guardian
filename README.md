# AltText Guardian

Image-heavy subs (r/aww, r/Art, r/photography, r/OldSchoolCool) are effectively unusable for screen-reader users because almost no posts have descriptions. AltText Guardian detects image submissions lacking a description in the post body, prompts the OP via auto-comment, optionally generates a draft alt-text using a vision model for the OP to approve and post as a top-level comment, and tracks compliance over time. Mods get a queue view of "images missing descriptions."

## Features

- **Image detection** — Automatically identifies image and gallery posts (i.redd.it, imgur, Reddit galleries, etc.)
- **Grace period** — Gives OP a configurable window (default: 10 minutes) to add a description before nudging
- **Friendly nudge** — Posts an accessibility-focused comment reminding OP to add a description
- **Auto-draft alt-text** — Optionally generates a suggested description using Claude's vision API
- **Compliance tracking** — Tracks stats (organic descriptions, post-nudge additions, still missing) in Redis
- **Mod queue** — Menu items to view a dashboard and list of non-compliant posts
- **Flair support** — Optionally flairs posts that are missing descriptions

## Configuration

Mods can configure these settings per-subreddit after installing:

| Setting | Default | Description |
|---------|---------|-------------|
| Grace period | 10 min | Time before nudging OP |
| Min description length | 50 chars | Minimum characters for a valid description |
| Enable auto-draft | true | Generate alt-text suggestions with Claude Vision |
| Enable flair | false | Flair non-compliant posts |
| Flair text | "Needs Description" | Text for non-compliance flair |
| Anthropic API key | — | Required for auto-draft feature |

## Project Structure

```
src/
├── main.tsx            # Entry point: config, triggers, scheduler, menu items
├── constants.ts        # Defaults, templates, Redis keys, types
├── imageDetection.ts   # Image post detection and description checking
└── visionApi.ts        # Claude vision API integration
```

## Development

```bash
npm install
npx tsc --noEmit    # Type-check
devvit upload       # Deploy to Reddit
```
