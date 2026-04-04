/**
 * Vision and Audio model detection utilities.
 *
 * Supports: Ollama, LM Studio, Claude, NVIDIA, OpenRouter
 */

// ── Vision patterns ──────────────────────────────────────────────────────────

const VISION_PATTERNS = [
  // Ollama / local models
  'vision', 'vl', 'llava', 'highiq', 'bakllava', 'moondream',
  'qwen3vision', 'qwenvision', 'qwen3-vl',
  'minicpm-v', 'internvl', 'cogvlm',
  'phi3vision', 'phi-3-vision', 'phi3-vision',
  'idefics', 'deepseek-vl', 'yi-vl',
  'glm-4', 'pixtral', 'llava-next', 'bunny',
  // OpenRouter / cloud models
  'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision',
  'claude-3', 'claude-sonnet', 'claude-opus', 'claude-haiku',
  'gemini-1.5', 'gemini-2.0', 'gemini-exp',
  'gemma-3', 'llama-3.2', 'llama-3.3', 'llama-4',
  'mistral-small', 'mistral-large', 'pixtral',
  'grok-2-vision', 'grok-3',
  'qwen-vl', 'qwen2.5-vl', 'qwen2-vl',
];

// ── Audio patterns ───────────────────────────────────────────────────────────

const AUDIO_PATTERNS = [
  // OpenAI
  'gpt-4o-audio', 'gpt-4o-mini-audio', 'whisper',
  // OpenRouter IDs
  'openai/whisper', 'openai/gpt-4o-audio',
  // Claude
  'claude-3-5-sonnet', 'claude-3-7-sonnet', 'claude-sonnet-4',
  // Gemini
  'gemini-1.5', 'gemini-2.0', 'gemini-exp',
];

/** Quick name-based vision check (no network call) */
export function isVisionModelByName(modelId) {
  const lower = modelId.toLowerCase();
  return VISION_PATTERNS.some(p => lower.includes(p));
}

/** Quick name-based audio check (no network call) */
export function isAudioModelByName(modelId) {
  const lower = modelId.toLowerCase();
  return AUDIO_PATTERNS.some(p => lower.includes(p));
}

/**
 * Check if a model supports vision based on backend type.
 * Returns { vision: boolean, audio: boolean }
 */
export function getModelCapabilities(backendKey, modelId) {
  const lower = (modelId || '').toLowerCase();

  // Claude: all Claude 3+ models support vision; Sonnet 3.5+ supports audio
  if (backendKey === 'claude') {
    return {
      vision: true,
      audio: lower.includes('sonnet') || lower.includes('opus'),
    };
  }

  // Gemini: all recent versions support vision + audio
  if (lower.includes('gemini')) {
    return { vision: true, audio: true };
  }

  // GPT-4o variants
  if (lower.includes('gpt-4o')) {
    return {
      vision: true,
      audio: lower.includes('audio') || lower.includes('mini'),
    };
  }

  // Whisper = audio only
  if (lower.includes('whisper')) {
    return { vision: false, audio: true };
  }

  // Llama 3.2+ supports vision
  if (lower.includes('llama-3.2') || lower.includes('llama-3.3') || lower.includes('llama-4')) {
    return { vision: true, audio: false };
  }

  // Gemma 3 supports vision
  if (lower.includes('gemma-3')) {
    return { vision: true, audio: false };
  }

  // Grok
  if (lower.includes('grok')) {
    return { vision: lower.includes('vision') || lower.includes('grok-3'), audio: lower.includes('grok-3') };
  }

  // Mistral
  if (lower.includes('mistral')) {
    return { vision: lower.includes('pixtral') || lower.includes('large') || lower.includes('small'), audio: false };
  }

  // Qwen VL
  if (lower.includes('qwen') && lower.includes('vl')) {
    return { vision: true, audio: false };
  }

  // Default: check patterns
  return {
    vision: VISION_PATTERNS.some(p => lower.includes(p)),
    audio: AUDIO_PATTERNS.some(p => lower.includes(p)),
  };
}

/**
 * Ask Ollama /api/show for explicit capabilities.
 * Returns { vision: boolean|null, audio: boolean|null }
 * null means "unknown — fall back to name check".
 */
export async function checkOllamaCapabilities(ollamaNativeBase, modelId) {
  try {
    const res = await fetch(`${ollamaNativeBase}/api/show`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: modelId, verbose: false }),
      signal:  AbortSignal.timeout(3000),
    });
    if (!res.ok) return { vision: null, audio: null };
    const data = await res.json();
    const caps = Array.isArray(data.capabilities) ? data.capabilities : [];
    return {
      vision: caps.includes('vision') || caps.includes('multimodal') ? true : null,
      audio: caps.includes('audio') ? true : null,
    };
  } catch {
    return { vision: null, audio: null };
  }
}

/**
 * Ask Ollama /api/show for explicit vision capability.
 * Returns true/false if the API answered, or null if unavailable.
 * @deprecated Use checkOllamaCapabilities instead
 */
export async function checkOllamaVisionCapability(ollamaNativeBase, modelId) {
  const result = await checkOllamaCapabilities(ollamaNativeBase, modelId);
  return result.vision;
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
