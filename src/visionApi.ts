/**
 * Alt-text generation using Google Gemini 2.0 Flash vision capabilities.
 * Fetches the image, base64-encodes it, and sends it via inline_data
 * for direct image understanding.
 */

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const VISION_PROMPT = `Describe this image for someone who cannot see it. Focus on:
1. What is depicted (people, objects, scene, action)
2. Key visual details that convey meaning
3. Any text visible in the image
4. Colors and composition only if relevant to understanding

Write a concise, informative description (2-4 sentences). Do not start with "This image shows" - just describe what's there directly.`;

/** Map common file extensions to MIME types. */
const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
};

interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: Array<{ text?: string }>;
    };
  }>;
}

/** Convert an ArrayBuffer to a base64 string. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Infer MIME type from a URL's file extension. */
function mimeTypeFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    for (const [ext, mime] of Object.entries(EXT_TO_MIME)) {
      if (pathname.endsWith(ext)) return mime;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/**
 * Generate alt-text for an image using Google Gemini 2.0 Flash.
 * Fetches the image from the given URL, base64-encodes it, and sends it
 * to Gemini via inline_data for direct image analysis.
 *
 * Requires a free API key from https://aistudio.google.com/apikey
 */
export async function generateAltText(
  imageUrl: string,
  apiKey: string
): Promise<string | null> {
  try {
    // 1. Fetch the image bytes
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
      return null;
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Data = arrayBufferToBase64(imageBuffer);

    // Determine MIME type from the response header, falling back to the URL extension
    const contentType = imageResponse.headers.get('content-type');
    const mimeType = contentType?.split(';')[0].trim() || mimeTypeFromUrl(imageUrl) || 'image/jpeg';

    // 2. Send to Gemini with inline_data for direct image vision
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data,
                },
              },
              {
                text: VISION_PROMPT,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Vision API error: ${response.status} ${response.statusText} - ${errorBody}`);
      return null;
    }

    const data = (await response.json()) as GeminiResponse;
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      console.error('Vision API returned empty content:', JSON.stringify(data));
      return null;
    }
    return content.trim();
  } catch (error) {
    console.error('Vision API request failed:', error);
    return null;
  }
}
