const CONFIG_CACHE_TTL = 5 * 60 * 1000;
let configCache = null;
let configCacheAt = 0;

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function slugify(value) {
  return String(value || '')
    .toLocaleLowerCase('de-DE')
    .replaceAll('ä','ae').replaceAll('ö','oe').replaceAll('ü','ue').replaceAll('ß','ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

export function basarPath(basar) {
  const place = basar?.stadt || basar?.ort || basar?.plz || '';
  const tail = [slugify(basar?.name), slugify(place)].filter(Boolean).join('-') || 'basar';
  return `/basar/${Number(basar?.id)}-${tail}`;
}

export function formatDateDe(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' })
      .format(new Date(`${value}T12:00:00Z`));
  } catch (_) { return String(value); }
}

export function formatTime(value) {
  return value ? String(value).slice(0, 5) : '';
}

export function euro(value) {
  return Number(value || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function parseConfigText(text) {
  const url = text.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i)?.[0] || '';
  const namedKey = text.match(/(?:supabasePublishableKey|SUPABASE_PUBLISHABLE_KEY|SUPABASE_ANON_KEY|anonKey|publishableKey)\s*[:=]\s*["'`]([^"'`]+)["'`]/i)?.[1] || '';
  const genericKey = text.match(/["'`](sb_publishable_[A-Za-z0-9._-]+|eyJ[A-Za-z0-9._-]{40,})["'`]/)?.[1] || '';
  return { supabaseUrl: url, supabaseKey: namedKey || genericKey };
}

export async function getSupabaseConfig(request, env = {}) {
  const envUrl = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL || '';
  const envKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.PUBLIC_SUPABASE_KEY || '';
  if (envUrl && envKey) return { supabaseUrl: envUrl, supabaseKey: envKey };

  if (configCache && Date.now() - configCacheAt < CONFIG_CACHE_TTL) return configCache;

  const origin = new URL(request.url).origin;
  const response = await fetch(`${origin}/config.js?v=292`, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!response.ok) throw new Error(`config.js konnte nicht geladen werden (${response.status}).`);
  const text = await response.text();
  const parsed = parseConfigText(text);
  if (!parsed.supabaseUrl || !parsed.supabaseKey) throw new Error('Supabase-Konfiguration konnte aus config.js nicht gelesen werden.');
  configCache = parsed;
  configCacheAt = Date.now();
  return parsed;
}

export async function rpc(request, env, functionName, body = {}) {
  const { supabaseUrl, supabaseKey } = await getSupabaseConfig(request, env);
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'authorization': `Bearer ${supabaseKey}`,
      'content-type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) throw new Error(`${functionName} fehlgeschlagen (${response.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

export async function getPublicBasars(request, env) {
  const data = await rpc(request, env, 'get_public_basare', {});
  return Array.isArray(data) ? data : [];
}

export async function getAvailability(request, env, id) {
  const data = await rpc(request, env, 'get_basar_availability', { p_basar_id: Number(id) });
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}
