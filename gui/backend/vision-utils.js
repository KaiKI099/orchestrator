/**
 * Vision model detection and image description utilities.
 *
 * Detection priority (Ollama):
 *   1. /api/show → capabilities[] ("vision") — most reliable (Ollama 0.5+)
 *   2. Model name pattern matching — fallback
 *
 * Detection (LM Studio):
 *   - Name pattern matching only (API doesn't expose capabilities)
 */

// Case-insensitive substrings that indicate a vision-capable model
const VISION_PATTERNS = [
  'vision', 'vl', 'llava', 'bakllava', 'moondream',
  'qwen3vision', 'qwenvision', 'qwen3-vl',
  'minicpm-v', 'internvl', 'cogvlm',
  'phi3vision', 'phi-3-vision', 'phi3-vision',
  'idefics', 'deepseek-vl', 'yi-vl',
  'glm-4', 'pixtral', 'llava-next', 'bunny',
];

/** Quick name-based check (no network call) */
export function isVisionModelByName(modelId) {
  const lower = modelId.toLowerCase();
  return VISION_PATTERNS.some(p => lower.includes(p));
}

/**
 * Ask Ollama /api/show for explicit capabilities.
 * Returns true/false if the API answered, or null if unavailable.
 */
export async function checkOllamaVisionCapability(ollamaNativeBase, modelId) {
  try {
    const res = await fetch(`${ollamaNativeBase}/api/show`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: modelId, verbose: false }),
      signal:  AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data.capabilities)) {
      return data.capabilities.some(c => c === 'vision' || c === 'multimodal');
    }
    return null; // older Ollama — fall back to name check
  } catch {
    return null;
  }
}

/**
 * Send an image to a vision model (via Ollama OpenAI-compatible endpoint)
 * and return a detailed text description.
 *
 * @param {object} opts
 * @param {string} opts.base64         Pure base64 image data (no data: prefix)
 * @param {string} opts.mimeType       e.g. "image/png"
 * @param {string} opts.ollamaV1Url    e.g. "http://localhost:11434/v1"
 * @param {string} [opts.describeModel] Defaults to "qwen3-vl:32b"
 * @returns {Promise<string>} The description text
 */
export async function describeImage({
  base64,
  mimeType,
  ollamaV1Url,
  describeModel = 'adelnazmy2002/Qwen3-VL-8B-Instruct',
}) {
  const res = await fetch(`${ollamaV1Url}/chat/completions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:      describeModel,
      stream:     false,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describe this image in comprehensive detail. Include: all visible text (exact wording), UI elements and layout (if a screenshot), objects, colours, diagrams, charts, code snippets, and any other relevant information. Be thorough and precise.',
          },
          {
            type:      'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` },
          },
        ],
      }],
    }),
    signal: AbortSignal.timeout(90_000), // vision models can be slow
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`Vision model "${describeModel}" error: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}
