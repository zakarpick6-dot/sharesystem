'use strict';
// The whole backend in one file: login + files. Runs on Vercel (free plan).
const crypto = require('crypto');

// Owner login. Set OWNER_USERNAME / OWNER_PASSWORD in Vercel to change them.
const USER = process.env.OWNER_USERNAME || 'revomakeadmin';
const PASS = process.env.OWNER_PASSWORD || 'secret1';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('rv|' + USER + '|' + PASS).digest('hex');

const DB_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const DB_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const MAX_TEXT = 700000, DAYS7 = 7 * 24 * 3600 * 1000;

async function db(cmd) {
  if (!DB_URL || !DB_TOKEN) throw new Error('Database not connected yet. In Vercel: Storage → add Upstash Redis → connect to this project → Redeploy.');
  const r = await fetch(DB_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + DB_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'Database error');
  return j.result;
}
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');

function isOwner(req) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(sign(exp), sig);
}
function out(res, code, obj, headers) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const k in headers || {}) res.setHeader(k, headers[k]);
  res.end(JSON.stringify(obj));
}
const name = n => String(n || 'untitled.txt').replace(/[\r\n\t]/g, ' ').trim().slice(0, 120) || 'untitled.txt';
const meta = f => ({ id: f.id, name: f.name, added: f.added, updated: f.updated, size: f.text.length, public: f.public });
const today = () => new Date().toISOString().slice(0, 10);

module.exports = async (req, res) => {
  try {
    const q = req.query || {}, act = String(q.do || '');
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
    const own = isOwner(req);

    if (req.method === 'POST') {   // block other websites from sending requests
      const o = req.headers.origin;
      if (o) { let ok = false; try { ok = new URL(o).host === req.headers.host; } catch (e) { /* bad origin */ } if (!ok) return out(res, 403, { error: 'Bad origin' }); }
    }

    if (act === 'me') return out(res, 200, { owner: own });

    if (act === 'login' && req.method === 'POST') {
      const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim(), key = 'rl:' + ip;
      const n = await db(['INCR', key]);
      if (n === 1) await db(['EXPIRE', key, 600]);
      if (n > 8) return out(res, 429, { error: 'Too many tries. Wait 10 minutes.' });
      const okUser = same(String(b.username || '').toLowerCase(), USER.toLowerCase()), okPass = same(b.password || '', PASS);
      if (!(okUser && okPass)) return out(res, 401, { error: 'Wrong username or password' });
      await db(['DEL', key]);
      const exp = String(Date.now() + DAYS7);
      return out(res, 200, { ok: true }, { 'Set-Cookie': 'sid=' + exp + '.' + sign(exp) + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + DAYS7 / 1000 });
    }
    if (act === 'logout' && req.method === 'POST') return out(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });

    if (act === 'list') {
      const flat = (await db(['HGETALL', 'files'])) || [], all = [];
      for (let i = 1; i < flat.length; i += 2) { try { all.push(JSON.parse(flat[i])); } catch (e) { /* skip */ } }
      all.sort((x, y) => (x.added + x.id < y.added + y.id ? -1 : 1));
      return out(res, 200, all.filter(f => own || f.public).map(meta));
    }
    if (act === 'get') {
      const id = String(q.id || '');
      const v = /^[a-f0-9]{12}$/.test(id) ? await db(['HGET', 'files', id]) : null, f = v && JSON.parse(v);
      if (!f || (!f.public && !own)) return out(res, 404, { error: 'Not found' });
      return out(res, 200, Object.assign(meta(f), { text: f.text }));
    }

    // everything below is owner only
    if (['add', 'edit', 'remove'].includes(act) && req.method === 'POST') {
      if (!own) return out(res, 401, { error: 'Please log in' });
      if (act === 'add') {
        const text = String(b.text || '');
        if (text.length > MAX_TEXT) return out(res, 413, { error: 'File is too big (max about 700 KB).' });
        const f = { id: crypto.randomBytes(6).toString('hex'), name: name(b.name), text, added: today(), updated: today(), public: b.public !== false };
        await db(['HSET', 'files', f.id, JSON.stringify(f)]);
        return out(res, 201, meta(f));
      }
      const id = String(b.id || '');
      const v = /^[a-f0-9]{12}$/.test(id) ? await db(['HGET', 'files', id]) : null, f = v && JSON.parse(v);
      if (!f) return out(res, 404, { error: 'Not found' });
      if (act === 'remove') { await db(['HDEL', 'files', id]); return out(res, 200, { ok: true }); }
      if (b.name !== undefined) f.name = name(b.name);
      if (b.text !== undefined) { if (String(b.text).length > MAX_TEXT) return out(res, 413, { error: 'Text is too big (max about 700 KB).' }); f.text = String(b.text); }
      if (b.public !== undefined) f.public = !!b.public;
      f.updated = today();
      await db(['HSET', 'files', id, JSON.stringify(f)]);
      return out(res, 200, meta(f));
    }
    out(res, 404, { error: 'Not found' });
  } catch (e) { console.error(e); out(res, 500, { error: e.message || 'Server error' }); }
};
