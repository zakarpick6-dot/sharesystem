'use strict';
// The whole backend in one file: login + files. Runs on Vercel (free plan).
const crypto = require('crypto');

// Owner login. Set OWNER_USERNAME / OWNER_PASSWORD in Vercel to change them.
const USER = process.env.OWNER_USERNAME || 'revomakeadmin';
const PASS = process.env.OWNER_PASSWORD || 'secret1';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('rv|' + USER + '|' + PASS).digest('hex');

// Finds the database settings whatever prefix Vercel gave them (UPSTASH_REDIS_REST_*, KV_REST_API_*, STORAGE_KV_REST_API_*, ...)
const pick = suf => process.env['UPSTASH_REDIS_REST_' + suf] || process.env['KV_REST_API_' + suf] ||
  process.env[Object.keys(process.env).find(k => k.endsWith('_REST_API_' + suf) || k.endsWith('_REDIS_REST_' + suf)) || ''];
const DB_URL = pick('URL'), DB_TOKEN = pick('TOKEN');
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
const meta = f => ({ id: f.id, name: f.name, added: f.added, updated: f.updated, size: f.text.length, shared: !!f.share, share: f.share || null });
const today = () => new Date().toISOString().slice(0, 10);
const ID = /^[a-f0-9]{12}$/, TOK = /^[a-f0-9]{32}$/;
const byId = async id => { const v = ID.test(String(id)) ? await db(['HGET', 'files', String(id)]) : null; return v ? JSON.parse(v) : null; };
const save = f => db(['HSET', 'files', f.id, JSON.stringify(f)]);

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

    // Anyone with a share link sees ONLY that one file. Nobody can list the others.
    if (act === 'get') {
      const t = String(q.t || '');
      if (TOK.test(t)) {
        const fid = await db(['HGET', 'shares', t]), f = fid && await byId(fid);
        if (f && f.share === t) return out(res, 200, { name: f.name, updated: f.updated, size: f.text.length, text: f.text });
        return out(res, 404, { error: 'This link does not work anymore.' });
      }
      const f = own && await byId(q.id);
      if (f) return out(res, 200, Object.assign(meta(f), { text: f.text }));
      return out(res, 404, { error: 'Not found' });
    }

    // everything below is owner only
    if (!own) return out(res, 401, { error: 'Please log in' });

    if (act === 'list') {
      const flat = (await db(['HGETALL', 'files'])) || [], all = [];
      for (let i = 1; i < flat.length; i += 2) { try { all.push(JSON.parse(flat[i])); } catch (e) { /* skip */ } }
      all.sort((x, y) => (x.added + x.id < y.added + y.id ? -1 : 1));
      return out(res, 200, all.map(meta));
    }
    if (req.method === 'POST' && act === 'add') {
      const text = String(b.text || '');
      if (text.length > MAX_TEXT) return out(res, 413, { error: 'File is too big (max about 700 KB).' });
      const f = { id: crypto.randomBytes(6).toString('hex'), name: name(b.name), text, added: today(), updated: today(), share: null };
      await save(f);
      return out(res, 201, meta(f));
    }
    if (req.method === 'POST' && ['edit', 'remove', 'share', 'unshare'].includes(act)) {
      const f = await byId(b.id);
      if (!f) return out(res, 404, { error: 'Not found' });
      if (act === 'remove') { if (f.share) await db(['HDEL', 'shares', f.share]); await db(['HDEL', 'files', f.id]); return out(res, 200, { ok: true }); }
      if (act === 'share') {
        if (!f.share) { f.share = crypto.randomBytes(16).toString('hex'); await db(['HSET', 'shares', f.share, f.id]); await save(f); }
        return out(res, 200, { share: f.share });
      }
      if (act === 'unshare') { if (f.share) { await db(['HDEL', 'shares', f.share]); f.share = null; await save(f); } return out(res, 200, { ok: true }); }
      if (b.name !== undefined) f.name = name(b.name);
      if (b.text !== undefined) { if (String(b.text).length > MAX_TEXT) return out(res, 413, { error: 'Text is too big (max about 700 KB).' }); f.text = String(b.text); }
      f.updated = today();
      await save(f);
      return out(res, 200, meta(f));
    }
    out(res, 404, { error: 'Not found' });
  } catch (e) { console.error(e); out(res, 500, { error: e.message || 'Server error' }); }
};
