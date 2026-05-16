const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const VISION_PROMPT = `Describe this image for someone who cannot see it. Focus on:
1. What is depicted (people, objects, scene, action)
2. Key visual details that convey meaning
3. Any text visible in the image
4. Colors and composition only if relevant to understanding

Write a concise, informative description (2-4 sentences). Do not start with "This image shows" - just describe what's there directly.`;

interface VisionResponse {
  content: Array<{ type: string; text?: string }>;
}

/**
 * Generate alt-text for an image using Claude's vision API.
 * Uses global fetch (enabled by Devvit.configure({ http: true })).
 */
export async function generateAltText(
  imageUrl: string,
  apiKey: string
): Promise<string | null> {
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'url',
                  url: imageUrl,
                },
              },
              {
                type: 'text',
                text: VISION_PROMPT,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error(`Vision API error: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as VisionResponse;
    if (data?.content?.[0]?.type === 'text') {
      return data.content[0].text ?? null;
    }

    return null;
  } catch (error) {
    console.error('Vision API request failed:', error);
    return null;
  }
}
