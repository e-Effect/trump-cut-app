const MAX_BYTES = 131072;
const allowedOrigins = new Set(['https://e-effect.github.io', 'null']);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    if (allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (origin && !allowedOrigins.has(origin)) return reply({ error: 'このページからは利用できません。' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'POSTが必要です。' }, 405);
    const route = new URL(request.url).pathname;
    if (!['/upload', '/download'].includes(route)) return reply({ error: '見つかりません。' }, 404);
    try {
      const { success } = await env.LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
      if (!success) return reply({ error: '操作が続いています。1分ほど待って再試行してください。' }, 429);
      if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return reply({ error: 'フレーズが長すぎます。' }, 413);
      // Bound the streamed body too: Content-Length is not always supplied.
      const reader = request.body?.getReader();
      if (!reader) return reply({ error: 'データがありません。' }, 400);
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          return reply({ error: 'フレーズが長すぎます。' }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let body;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return reply({ error: 'データの形式が正しくありません。' }, 400); }
      if (route === '/download') {
        const code = String(body?.code || '').replace(/-/g, '').trim().toLowerCase();
        if (!/^[a-f0-9]{32}$/.test(code)) return reply({ error: '合言葉を確認してください。' }, 400);
        const saved = await env.PHRASES.get(`phrases:${code}`, 'json');
        if (!saved) return reply({ error: '合言葉に対応するフレーズが見つかりません。' }, 404);
        return reply(saved);
      }
      if (!body?.phrases || typeof body.phrases !== 'object' || Array.isArray(body.phrases)) {
        return reply({ error: 'フレーズの形式が正しくありません。' }, 400);
      }
      const phrases = {};
      for (let i = 1; i <= 52; i++) {
        const entry = body.phrases[String(i)];
        if (!entry || typeof entry.text !== 'string' || entry.text.length > 2000 ||
            !['back', 'front'].includes(entry.orientation) ||
            !(entry.autoFrom == null || (Number.isInteger(entry.autoFrom) && entry.autoFrom >= 1 && entry.autoFrom <= 52))) {
          return reply({ error: 'フレーズの形式が正しくありません。' }, 400);
        }
        phrases[String(i)] = { text: entry.text, orientation: entry.orientation, autoFrom: entry.autoFrom ?? null };
      }
      const random = crypto.getRandomValues(new Uint8Array(16));
      const code = Array.from(random, n => n.toString(16).padStart(2, '0')).join('');
      const saved = { app: 'True Cut', type: 'phrase-settings', version: 2, savedAt: new Date().toISOString(), phrases };
      await env.PHRASES.put(`phrases:${code}`, JSON.stringify(saved));
      return reply({ code: code.match(/.{8}/g).join('-'), savedAt: saved.savedAt }, 201);
    } catch {
      return reply({ error: '保存先に接続できませんでした。少し待って再試行してください。' }, 503);
    }
  },
};
