// =====================================================================
// lib/llm.js  ·  the one place the suite talks to a model
//
// Anthropic's Messages API, behind a function that takes the shape the
// tools already send. Drop this file at the repository root, in lib/,
// in all five tool repositories. It sits outside api/ because every
// file inside api/ becomes a routable function on Vercel, and this is
// a library rather than an endpoint.
//
// One file, not five. The PDF generator taught us what five copies of
// a shared thing costs: it drifted into five different revisions and
// every fix had to be applied six times.
//
// Three differences from the OpenAI call this replaces:
//   1. The system prompt is a top-level field, not a message.
//   2. The reply is an array of content blocks, not choices.
//   3. Overload is 529, not 503.
// All three are handled here so no tool has to know about them.
// =====================================================================

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

// Sonnet writes the documents. Haiku runs the sharpening check, which is
// a short classification the manager is waiting on, so speed matters more
// than depth there.
//
// Both are eligible for zero data retention. Do not move these to Fable or
// Mythos without checking: those are Covered Models, they carry a mandatory
// thirty day retention, and they are excluded from ZDR. The model name is
// a data protection decision on this product, not just a quality one.
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const FAST_MODEL = process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5';

/**
 * Ask the model for one completion.
 *
 * @param {object}  opts
 * @param {Array}   opts.messages     [{role, content}], as the tools already build them
 * @param {string} [opts.system]      system prompt, if the tool has one
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {boolean}[opts.fast]        use the quick model, for checks rather than documents
 * @param {string} [opts.model]       override both
 *
 * @returns {Promise<{ok: boolean, text: string, status: number, error?: string}>}
 *          Never throws. Every caller gets a verdict it can act on.
 */
export async function complete(opts = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, text: '', status: 500, error: 'ANTHROPIC_API_KEY is not set.' };
  }

  const { system, messages } = splitSystem(opts.messages, opts.system);
  if (!messages.length) {
    return { ok: false, text: '', status: 400, error: 'No messages to send.' };
  }

  const body = {
    model: opts.model || (opts.fast ? FAST_MODEL : DEFAULT_MODEL),
    max_tokens: opts.maxTokens || 4000,
    messages,
  };
  if (system) body.system = system;

  // No temperature. The current models reject it outright: "`temperature` is
  // deprecated for this model" comes back as a 400 and the manager sees
  // "Something went wrong". Callers may still pass one, and it is ignored here
  // rather than at five call sites. Default sampling is what we want anyway.

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, text: '', status: 502, error: `Could not reach the model. ${e.message}` };
  }

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    // 429 is our rate limit, 529 is Anthropic overloaded. Both mean try again,
    // and both should read the same way to a manager standing in a doorway.
    const busy = response.status === 429 || response.status === 529;
    console.error('Anthropic error', response.status, JSON.stringify(detail).slice(0, 500));
    return {
      ok: false,
      text: '',
      status: busy ? 503 : 500,
      error: busy
        ? 'The service is busy right now. Please try again in a moment.'
        : 'Something went wrong. Please try again.',
    };
  }

  const data = await response.json().catch(() => null);
  return { ok: true, text: textFrom(data), status: 200 };
}

/**
 * The four writing tools read `data.choices[0].message.content`, because
 * that is the shape they were built against. Rather than edit four large
 * App.jsx files that have broken the build every time they were touched,
 * hand them back the envelope they expect.
 *
 * This is a deliberate shim and it should go when those front ends are next
 * opened for another reason. It is recorded here so nobody finds it in a
 * year and wonders whether the suite still calls OpenAI. It does not.
 */
export function asChatCompletion(text) {
  return { choices: [{ message: { role: 'assistant', content: text || '' } }] };
}

// ---------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------

/**
 * Anthropic takes the system prompt as its own field and rejects a message
 * with role 'system'. The tools send everything as messages, so pull any
 * system turns out and join them.
 */
function splitSystem(rawMessages, explicitSystem) {
  const all = Array.isArray(rawMessages) ? rawMessages : [];
  const systemParts = [];
  const messages = [];

  if (explicitSystem) systemParts.push(String(explicitSystem));

  for (const m of all) {
    if (!m || typeof m.content !== 'string' || !m.content.trim()) continue;
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    messages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    });
  }

  // The first turn has to be the user's. If a stray assistant turn leads,
  // drop it rather than let the request fail.
  while (messages.length && messages[0].role === 'assistant') messages.shift();

  return { system: systemParts.join('\n\n').trim(), messages };
}

/** The reply is an array of content blocks. Take the text ones, in order. */
function textFrom(data) {
  const blocks = data && Array.isArray(data.content) ? data.content : [];
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim();
}

