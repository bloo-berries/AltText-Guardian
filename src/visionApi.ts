/**
 * Alt-text generation using open-source vision models via Hugging Face Inference Providers.
 * Uses the OpenAI-compatible chat completions endpoint at router.huggingface.co.
 * Model: Qwen/Qwen2.5-VL-7B-Instruct (open-source, Apache 2.0 licensed)
 */

const HF_ROUTER_URL = 'https://router.huggingface.co/v1/chat/completions';
const MODEL = 'Qwen/Qwen2.5-VL-7B-Instruct';

const VISION_PROMPT = `Describe this image for someone who cannot see it. Focus on:
1. What is depicted (people, objects, scene, action)
2. Key visual details that convey meaning
3. Any text visible in the image
4. Colors and composition only if relevant to understanding

Write a concise, informative description (2-4 sentences). Do not start with "This image shows" - just describe what's there directly.`;

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * Generate alt-text for an image using an open-source vision model via Hugging Face.
 * Requires a free Hugging Face API token (https://huggingface.co/settings/tokens).
 */
export async function generateAltText(
  imageUrl: string,
  hfToken: string
): Promise<string | null> {
  try {
    const response = await fetch(HF_ROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hfToken}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: imageUrl },
              },
              {
                type: 'text',
                text: VISION_PROMPT,
              },
            ],
          },
        ],
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      console.error(`Vision API error: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data?.choices?.[0]?.message?.content;
    return content?.trim() ?? null;
  } catch (error) {
    console.error('Vision API request failed:', error);
    return null;
  }
}
