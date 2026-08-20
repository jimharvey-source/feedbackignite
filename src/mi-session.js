// =====================================================================
// Management Ignition · shared suite session
//
// One signed-in account across app.management-ignition.com and the five
// tool subdomains. The session lives in a cookie scoped to the parent
// domain, so every tool reads it without being handed anything.
//
// Drop this file into src/lib/ in all six repositories. It is front end
// code, bundled by Vite, so there is no CommonJS variant to worry about.
// The ES module split only applies to the api/ serverless files.
// =====================================================================

import { createClient } from '@supabase/supabase-js';

const PARENT_DOMAIN = 'management-ignition.com';
const COOKIE_DOMAIN = '.management-ignition.com';

// Browsers cap a cookie at about 4096 bytes including the name and the
// attributes. Chunk the encoded value well below that.
const CHUNK_SIZE = 3000;
const MAX_CHUNKS = 20;
const CHUNK_MARKER = 'mi-chunks:';

// ---------------------------------------------------------------------
// Where can we write a parent domain cookie
// ---------------------------------------------------------------------

function onSuiteDomain() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === PARENT_DOMAIN || h.endsWith('.' + PARENT_DOMAIN);
}

// ---------------------------------------------------------------------
// Raw cookie access. Values are written already encoded, so nothing here
// encodes twice.
// ---------------------------------------------------------------------

function writeRaw(name, encodedValue, days = 30) {
  const expires = new Date(Date.now() + days * 86400000).toUTCString();
  const domain = onSuiteDomain() ? `; domain=${COOKIE_DOMAIN}` : '';
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie =
    `${name}=${encodedValue}; expires=${expires}; path=/${domain}${secure}; samesite=lax`;
}

function readRaw(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + escaped + '=([^;]*)'));
  return match ? match[1] : null;
}

function eraseRaw(name) {
  const domain = onSuiteDomain() ? `; domain=${COOKIE_DOMAIN}` : '';
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
  // Also clear any host-only copy left behind by an earlier version.
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

function eraseChunks(key) {
  for (let i = 0; i < MAX_CHUNKS; i++) {
    if (readRaw(`${key}.${i}`) === null) break;
    eraseRaw(`${key}.${i}`);
  }
}

// ---------------------------------------------------------------------
// The storage adapter Supabase will use
// ---------------------------------------------------------------------

export const cookieStorage = {
  getItem(key) {
    const head = readRaw(key);
    if (head === null) return null;

    if (!head.startsWith(CHUNK_MARKER)) {
      try { return decodeURIComponent(head); } catch { return null; }
    }

    const count = parseInt(head.slice(CHUNK_MARKER.length), 10);
    if (!Number.isFinite(count) || count < 1 || count > MAX_CHUNKS) return null;

    let joined = '';
    for (let i = 0; i < count; i++) {
      const part = readRaw(`${key}.${i}`);
      // A missing chunk means a half written session. Treat it as absent
      // rather than handing Supabase a truncated token.
      if (part === null) return null;
      joined += part;
    }
    try { return decodeURIComponent(joined); } catch { return null; }
  },

  setItem(key, value) {
    const encoded = encodeURIComponent(value);
    eraseChunks(key);

    if (encoded.length <= CHUNK_SIZE) {
      writeRaw(key, encoded);
      return;
    }

    const count = Math.ceil(encoded.length / CHUNK_SIZE);
    if (count > MAX_CHUNKS) {
      console.error('Session too large for cookie storage.');
      return;
    }
    for (let i = 0; i < count; i++) {
      writeRaw(`${key}.${i}`, encoded.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
    writeRaw(key, CHUNK_MARKER + count);
  },

  removeItem(key) {
    eraseChunks(key);
    eraseRaw(key);
  },
};

// On localhost and on *.vercel.app a parent domain cookie cannot be set,
// so fall back to local storage. Development keeps working, and the
// shared session only applies where it can.
function pickStorage() {
  if (typeof window === 'undefined') return undefined;
  return onSuiteDomain() ? cookieStorage : window.localStorage;
}

// ---------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.url        Supabase project URL
 * @param {string} opts.anonKey    Supabase anon key
 * @param {string} [opts.schema]   Default Postgres schema. The app layer
 *                                 passes 'app'. The five tools leave this
 *                                 alone so their own public tables keep
 *                                 working, and reach the app schema with
 *                                 client.schema('app') when they need it.
 */
export function createSuiteClient({ url, anonKey, schema }) {
  return createClient(url, anonKey, {
    db: schema ? { schema } : undefined,
    auth: {
      storage: pickStorage(),
      storageKey: 'mi-auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
}

// ---------------------------------------------------------------------
// Helpers the tools use
// ---------------------------------------------------------------------

/** The person the app sent us to, if any. */
export function personIdFromUrl() {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('mi_person');
  return /^[0-9a-f-]{36}$/i.test(id || '') ? id : null;
}

/** Does this account have the full suite? Reads one function. */
export async function hasSuiteAccess(client) {
  const { data, error } = await client.schema('app').rpc('my_access');
  if (error) return false;
  return Boolean(data);
}

/** A session handed across from another tool, for the cross-tool chain. */
export function sourceSessionIdFromUrl() {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('mi_from');
  return /^[0-9a-f-]{36}$/i.test(id || '') ? id : null;
}

/** Load one saved session, so a tool can start from what another one produced. */
export async function loadSession(client, sessionId) {
  if (!sessionId) return null;
  const { data } = await client
    .schema('app')
    .from('sessions')
    .select('id, tool, title, person_id, inputs, outputs, occurred_at')
    .eq('id', sessionId)
    .maybeSingle();
  return data || null;
}

/** Read a person's context so a tool can pre-fill its personal fields. */
export async function loadPerson(client, personId) {
  if (!personId) return null;
  const { data } = await client
    .schema('app')
    .from('people')
    .select('id, first_name, last_name, role_title, motivation, strengths, development_focus, confidence_note')
    .eq('id', personId)
    .maybeSingle();
  return data || null;
}

/**
 * Save a finished tool run to a person's record.
 *
 * @param {object} client
 * @param {object} args
 * @param {'goal'|'delegate'|'feedback'|'coach'|'meeting'} args.tool
 * @param {string}  args.personId
 * @param {string} [args.title]
 * @param {object} [args.inputs]           the form, as it stood
 * @param {object} [args.outputs]          both outputs, plus guide/cadence
 * @param {string} [args.sourceSessionId]  where this came from, for the chain
 */
export async function saveToolSession(client, args) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { data: null, error: new Error('Not signed in.') };

  return client.schema('app').from('sessions').insert({
    account_id: user.id,
    person_id: args.personId || null,
    tool: args.tool,
    title: args.title || null,
    inputs: args.inputs || {},
    outputs: args.outputs || {},
    source_session_id: args.sourceSessionId || null,
  }).select().maybeSingle();
}

/** Record something the manager and the person agreed to do. */
export async function saveAction(client, { personId, sessionId, description, dueOn, owner }) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { data: null, error: new Error('Not signed in.') };

  return client.schema('app').from('actions').insert({
    account_id: user.id,
    person_id: personId || null,
    session_id: sessionId || null,
    description,
    due_on: dueOn || null,
    owner: owner || 'person',
  }).select().maybeSingle();
}
