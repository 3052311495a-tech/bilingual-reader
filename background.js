/* 我的双语阅读 — 后台：翻译服务（Gemini / DeepSeek 等 OpenAI 兼容接口）、缓存、词典、讲解 */

/* 本机预置配置（可选文件，内含 API Key，不进主代码） */
try { importScripts('local-config.js'); } catch (e) { /* 没有就跳过 */ }
const LOCAL_DEFAULTS = (self.__ITT_LOCAL__ && self.__ITT_LOCAL__.settings) || {};

const DEFAULTS = {
  provider: 'gemini',          // gemini | openai（DeepSeek 走这个）
  apiKey: '',                  // Gemini
  geminiBase: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-2.5-flash',
  dsKey: '',                   // DeepSeek / OpenAI 兼容
  dsBase: 'https://api.deepseek.com',
  dsModel: 'deepseek-flash',

  targetLang: '简体中文',
  autoTranslate: true,
  highlightWords: true,
  enableSelection: true,
  enableHover: true,
  hoverMode: 'ctrl',        // ctrl | alt | off
  hoverDelay: 120,
  hlStyle: 'yellow',        // yellow | underline | underline-bg | bg
  hlToday: true, hlNew: true, hlKnown: true,
  displayMode: 'bilingual' // bilingual | target
};

const GEMINI_BASE_DEFAULT = 'https://generativelanguage.googleapis.com/v1beta';

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return Object.assign({}, DEFAULTS, LOCAL_DEFAULTS, settings || {});
}

function hasKey(s) {
  return s.provider === 'openai' ? !!s.dsKey : !!s.apiKey;
}

function noKeyError(s) {
  const err = new Error(s.provider === 'openai'
    ? '还没有填 DeepSeek API Key：点扩展图标 → 设置'
    : '还没有填 Gemini API Key：点扩展图标 → 设置');
  err.code = 'NO_KEY';
  return err;
}

function cachePrefix(s) {
  return s.provider === 'openai'
    ? `o:${s.dsBase}:${s.dsModel}`
    : `g:${s.model}`;
}

/* ---------- 翻译缓存 ---------- */
let cachePromise = null;
async function getCache() {
  if (!cachePromise) {
    cachePromise = (async () => {
      const { tcache } = await chrome.storage.local.get('tcache');
      return tcache || {};
    })();
  }
  return cachePromise;
}

let saveTimer = null;
function persistCacheSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      const c = await getCache();
      const keys = Object.keys(c);
      if (keys.length > 6000) {
        keys.sort((a, b) => (c[a].t || 0) - (c[b].t || 0));
        for (const k of keys.slice(0, keys.length - 6000)) delete c[k];
      }
      await chrome.storage.local.set({ tcache: c });
    } catch (e) { /* 忽略 */ }
  }, 1200);
}

/* ---------- Gemini ---------- */
async function geminiCall(prompt, opts, s) {
  const { json = false, temperature = 0.2 } = opts;
  const base = (s.geminiBase || GEMINI_BASE_DEFAULT).replace(/\/+$/, '');
  const url = `${base}/models/${encodeURIComponent(s.model)}:generateContent?key=${encodeURIComponent(s.apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature }
  };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  // pro 系列关不掉思考，思考 token 也算进上限，别给它设上限免得截断
  if (opts.maxTokens && opts.thinking !== 'on' && !/pro/i.test(s.model)) body.generationConfig.maxOutputTokens = opts.maxTokens;
  // gemini-2.5 系列默认开「思考」，查词/翻译时每次要多想好几秒：flash 系列可以直接关（budget 0），pro 最低 128。
  // 2.0 系列不认这个字段，别发
  if (opts.thinking !== 'on') {
    if (/2\.5-flash/i.test(s.model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    else if (/2\.5-pro/i.test(s.model)) body.generationConfig.thinkingConfig = { thinkingBudget: 128 };
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error('连不上 Gemini：' + (e.message || e));
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j && j.error && j.error.message) || ''; } catch (e) {}
    const err = new Error(`Gemini ${res.status}${detail ? ' · ' + String(detail).slice(0, 240) : ''}`);
    if (/API key not valid|API_KEY_INVALID/i.test(detail)) err.code = 'BAD_KEY';
    else if (res.status === 429) err.code = 'RATE';
    else err.code = 'HTTP';
    throw err;
  }

  const data = await res.json();
  const cand = (data.candidates && data.candidates[0]) || {};
  const parts = (cand.content && cand.content.parts) || [];
  const text = parts.map(p => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini 返回空内容（可能被安全策略拦截）');
  return text;
}

/* ---------- DeepSeek / OpenAI 兼容 ---------- */
async function openaiCall(prompt, opts, s) {
  const { json = false, temperature = 0.2 } = opts;
  const base = (s.dsBase || DEFAULTS.dsBase).replace(/\/+$/, '');
  const url = base + '/chat/completions';
  const body = {
    model: s.dsModel || DEFAULTS.dsModel,
    messages: [{ role: 'user', content: prompt }],
    stream: false
  };
  // deepseek-reasoner 不接受 temperature / response_format
  const isReasoner = /reasoner/i.test(body.model);
  if (!isReasoner) {
    body.temperature = temperature;
    if (json) body.response_format = { type: 'json_object' };
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  // DeepSeek V4 系列默认开思考模式：翻译/查词要关掉才快，只提问时才开。
  // 仅对官方域名发送，免得严格的中转站因未知字段返回 400。
  if (/deepseek\.com/i.test(base)) {
    body.thinking = { type: opts.thinking === 'on' ? 'enabled' : 'disabled' };
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.dsKey
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error('连不上 ' + base + '：' + (e.message || e));
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j && j.error && j.error.message) || ''; } catch (e) {}
    const err = new Error(`${res.status}${detail ? ' · ' + String(detail).slice(0, 240) : ''}`);
    if (res.status === 401) err.code = 'BAD_KEY';
    else if (res.status === 429) err.code = 'RATE';
    else err.code = 'HTTP';
    throw err;
  }

  const data = await res.json();
  const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
  const text = String(msg.content || '').trim();
  if (!text) {
    const reason = data.choices && data.choices[0] && data.choices[0].finish_reason;
    throw new Error('返回空内容' + (reason ? '（finish_reason: ' + reason + '）' : ''));
  }
  return text;
}

/* ---------- 统一入口 ---------- */
async function llm(prompt, opts = {}) {
  const s = await getSettings();
  if (!hasKey(s)) throw noKeyError(s);
  if (s.provider === 'openai') return openaiCall(prompt, opts, s);
  return geminiCall(prompt, opts, s);
}

function extractJson(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch (e) {}
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
  const c = s.indexOf('{'), d = s.lastIndexOf('}');
  if (c >= 0 && d > c) { try { return JSON.parse(s.slice(c, d + 1)); } catch (e) {} }
  return null;
}

function pickString(x) {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    return x.translation || x.zh || x.text || x.t || x.content || x.output || '';
  }
  return '';
}

function buildTranslatePrompt(items, lang) {
  const body = items.map((t, i) => `<t id="${i + 1}">${t}</t>`).join('\n');
  return [
    `你是专业译者。把下面每条 <t> 里的文本翻译成${lang}。`,
    '规则：',
    `1. 只输出一个 JSON 数组，元素个数必须正好是 ${items.length}，第 k 个元素是第 k 条文本的译文；`,
    '2. 不要输出序号、解释、前缀或任何额外文字；',
    '3. 保留原文的人名、品牌名、代码、链接、数字、专有术语；',
    '4. 译文通顺、书面、适合长文阅读，不要逐字硬译；',
    `5. 如果某条本来就已经是${lang}或不需要翻译，就原样返回那一条。`,
    '',
    body
  ].join('\n');
}

/* DeepSeek 的 json_object 要求顶层是对象，这里再兜一层数组包装 */
function buildTranslatePromptWrapped(items, lang) {
  const body = items.map((t, i) => `<t id="${i + 1}">${t}</t>`).join('\n');
  return [
    `你是专业译者。把下面每条 <t> 里的文本翻译成${lang}。`,
    '规则：',
    `1. 只输出一个 JSON 对象：{"items":["译文1","译文2", ...]}，items 数组长度必须正好是 ${items.length}，顺序与输入一致；`,
    '2. 不要输出序号、解释或任何额外文字；',
    '3. 保留原文的人名、品牌名、代码、链接、数字、专有术语；',
    '4. 译文通顺、书面、适合长文阅读，不要逐字硬译；',
    `5. 如果某条本来就已经是${lang}或不需要翻译，就原样返回那一条。`,
    '',
    body
  ].join('\n');
}

async function translate(texts, lang) {
  const s = await getSettings();
  const cache = await getCache();
  const prefix = cachePrefix(s) + ':' + lang + ':';
  const out = {};
  const todo = [];
  for (const t of texts) {
    if (!t) continue;
    const k = prefix + t;
    if (cache[k]) out[t] = cache[k].v;
    else if (todo.indexOf(t) === -1) todo.push(t);
  }

  const chunks = [];
  let cur = [], len = 0;
  for (const t of todo) {
    if (cur.length >= 8 || len + t.length > 3200) {
      if (cur.length) chunks.push(cur);
      cur = []; len = 0;
    }
    cur.push(t); len += t.length;
  }
  if (cur.length) chunks.push(cur);

  for (const chunk of chunks) {
    let mapped = null;
    try {
      const prompt = s.provider === 'openai'
        ? buildTranslatePromptWrapped(chunk, lang)
        : buildTranslatePrompt(chunk, lang);
      const raw = await llm(prompt, { json: true, thinking: 'off' });
      const arr = extractJson(raw);
      if (Array.isArray(arr)) mapped = arr.map(pickString);
      else if (arr && typeof arr === 'object') {
        if (Array.isArray(arr.items)) mapped = arr.items.map(pickString);
        else mapped = Object.keys(arr).sort((a, b) => Number(a) - Number(b)).map(k => pickString(arr[k]));
      }
    } catch (e) {
      if (e.code === 'NO_KEY' || e.code === 'BAD_KEY') throw e;
      mapped = null;
    }

    for (let i = 0; i < chunk.length; i++) {
      const t = chunk[i];
      let v = mapped && mapped[i];
      if (!v) {
        try {
          v = await llm(`把下面这段文本翻译成${lang}。只输出译文，不要解释：\n\n${t}`, { temperature: 0.2 });
        } catch (e) {
          if (e.code === 'NO_KEY' || e.code === 'BAD_KEY') throw e;
          continue;
        }
      }
      v = String(v || '').trim();
      if (!v) continue;
      out[t] = v;
      cache[prefix + t] = { v, t: Date.now() };
    }
  }
  persistCacheSoon();
  return out;
}

/* 查词拆成两个并行的小请求：
   - core：拼写/音标/词性/释义，输出只有几十个 token，最快回来，卡片先显示它
   - extra：例句 + 例句翻译，回来后补进卡片
   两部分各自缓存，查过的词下次瞬间出 */
async function lookupWord(text) {
  const s = await getSettings();
  const cache = await getCache();
  const key = cachePrefix(s) + ':w:' + String(text).toLowerCase();
  if (cache[key]) return cache[key].v;

  const raw = await llm(
    `英汉词典。给出这个英文单词或短语的 JSON：` +
    `{"word":"原形","phonetic":"美式IPA，带斜杠","pos":"词性缩写如 n./v./adj./phr.","meaning":"中文释义，≤30字，多义用；分隔"}。只输出 JSON。\n\n${text}`,
    { json: true, thinking: 'off', temperature: 0, maxTokens: 120 }
  );

  const obj = extractJson(raw);
  if (!obj || typeof obj !== 'object') throw new Error('词典结果解析失败');
  const data = {
    word: obj.word || text,
    phonetic: obj.phonetic || '',
    pos: obj.pos || '',
    meaning: obj.meaning || obj.definition || ''
  };
  if (!data.meaning) throw new Error('没查到释义');
  cache[key] = { v: data, t: Date.now() };
  persistCacheSoon();
  return data;
}

/* 词对齐：英文原文里的生词，在中文译文里对应哪几个字。只在用生词本释义匹配不上时才调用 */
function hashStr(t) {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function alignWords(src, dst, words) {
  const s = await getSettings();
  const cache = await getCache();
  const base = cachePrefix(s) + ':al:' + hashStr(dst) + ':';
  const map = {};
  const todo = [];
  for (const w of words) {
    const k = base + w;
    if (cache[k]) map[w] = cache[k].v;
    else todo.push(w);
  }
  if (!todo.length) return map;

  const raw = await llm(
    `英文原文：${src}\n\n中文译文：${dst}\n\n` +
    `对下面每个英文词（可能以变形出现在原文里），找出它在中文译文里对应的那几个字。` +
    `要求：必须是译文里原样出现的连续片段，尽量短（通常 2-6 个字）；译文里没有对应就给空字符串。` +
    `只输出 JSON：{"items":[{"w":"英文词","zh":"译文片段"}]}\n\n词：${todo.join(', ')}`,
    { json: true, thinking: 'off', temperature: 0, maxTokens: 60 + todo.length * 30 }
  );
  const obj = extractJson(raw) || {};
  const items = Array.isArray(obj) ? obj : (obj.items || []);
  for (const it of items) {
    if (!it || !it.w) continue;
    const w = String(it.w).toLowerCase();
    const zh = String(it.zh || '').trim();
    if (todo.indexOf(w) < 0) continue;
    map[w] = zh && dst.indexOf(zh) >= 0 ? zh : '';
  }
  for (const w of todo) {
    if (!(w in map)) map[w] = '';
    cache[base + w] = { v: map[w], t: Date.now() };
  }
  persistCacheSoon();
  return map;
}

async function lookupExample(text) {
  const s = await getSettings();
  const cache = await getCache();
  const key = cachePrefix(s) + ':wx:' + String(text).toLowerCase();
  if (cache[key]) return cache[key].v;

  const raw = await llm(
    `给英文单词或短语「${text}」写一个自然地道、6-16 词的英文例句，并翻译成中文。` +
    `只输出 JSON：{"example":"英文例句","exampleZh":"中文翻译"}`,
    { json: true, thinking: 'off', temperature: 0.3, maxTokens: 120 }
  );
  const obj = extractJson(raw) || {};
  const data = { example: obj.example || '', exampleZh: obj.exampleZh || '' };
  if (data.example) {
    cache[key] = { v: data, t: Date.now() };
    persistCacheSoon();
  }
  return data;
}

async function explainWord(text, meaning) {
  return llm(
    `你是耐心的英语老师。学生刚在文章里读到 “${text}”${meaning ? `（词典释义：${meaning}）` : ''}。` +
    '请用中文讲四行，每行一句短话：\n' +
    '1) 词根或构词，或一个记忆点；\n' +
    '2) 两个高频搭配；\n' +
    '3) 一个容易混淆的近义词，以及区别；\n' +
    '4) 一个自测小题（只出题，不给答案）。',
    { temperature: 0.4, thinking: 'on' }
  );
}

/* ---------- 智能大纲 ---------- */
async function makeOutline(headings, excerpt) {
  const hs = (headings || []).slice(0, 60).map(h => `${'  '.repeat(Math.max(0, (h.level || 1) - 1))}- ${h.text}`).join('\n');
  const raw = await llm(
    '下面是一篇文章的标题结构和正文开头。请生成一份帮我快速把握全文的中文大纲。\n' +
    '只输出 JSON 数组，形如 [{"level":1,"title":"..."}]，4-12 条，level 取 1-3，每条标题不超过 18 个字，不要解释。\n\n' +
    `【标题结构】\n${hs || '（该页没有明显的标题标签）'}\n\n【正文开头】\n${String(excerpt || '').slice(0, 5000)}`,
    { json: true, thinking: 'off' }
  );
  const arr = extractJson(raw);
  const list = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.items) ? arr.items : null);
  if (!list) throw new Error('大纲解析失败');
  return list
    .filter(x => x && (x.title || x.text))
    .slice(0, 12)
    .map(x => ({
      level: Math.min(3, Math.max(1, Number(x.level) || 1)),
      title: String(x.title || x.text || '').slice(0, 40)
    }));
}

/* ---------- 测速 ---------- */
async function benchOne(kind) {
  const s = await getSettings();
  const probe = '只输出译文，不要解释：Time is money.';
  const t0 = Date.now();
  try {
    if (kind === 'gemini') {
      if (!s.apiKey) return { skipped: '没有填 Gemini Key' };
      await geminiCall(probe, { temperature: 0 }, s);
    } else {
      if (!s.dsKey) return { skipped: '没有填 DeepSeek/兼容接口 Key' };
      await openaiCall(probe, { temperature: 0, thinking: 'off' }, s);
    }
    return { ms: Date.now() - t0 };
  } catch (e) {
    return { error: String(e.message || e).slice(0, 140), code: e.code || 0 };
  }
}

/* ---------- 消息 ---------- */
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  (async () => {
    try {
      if (msg.type === 'translate') {
        const s = await getSettings();
        const results = await translate(msg.texts || [], s.targetLang);
        respond({ ok: true, results });
      } else if (msg.type === 'word') {
        respond({ ok: true, data: await lookupWord(msg.text) });
      } else if (msg.type === 'align') {
        respond({ ok: true, map: await alignWords(msg.src || '', msg.dst || '', msg.words || []) });
      } else if (msg.type === 'wordExample') {
        respond({ ok: true, data: await lookupExample(msg.text) });
      } else if (msg.type === 'explain') {
        respond({ ok: true, text: await explainWord(msg.text, msg.meaning) });
      } else if (msg.type === 'test') {
        const s = await getSettings();
        const text = await llm('只输出这句的译文，不要解释：Hello, world. 今天天气不错。', { temperature: 0, thinking: 'off' });
        respond({ ok: true, text, provider: s.provider });
      } else if (msg.type === 'outline') {
        respond({ ok: true, items: await makeOutline(msg.headings, msg.excerpt) });
      } else if (msg.type === 'bench') {
        const gemini = await benchOne('gemini');
        const openai = await benchOne('openai');
        respond({ ok: true, gemini, openai });
      } else if (msg.type === 'openOptions') {
        chrome.runtime.openOptionsPage();
        respond({ ok: true });
      } else {
        respond({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      const err = { msg: e.message || String(e), code: e.code || 0, ts: Date.now() };
      chrome.storage.local.set({ lastError: err }).catch(() => {});
      respond({ ok: false, error: err.msg, code: err.code });
    }
  })();
  return true;
});

chrome.commands.onCommand.addListener(async (cmd) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    const map = { 'toggle-mode': 'cycleMode', 'toggle-outline': 'toggleOutline' };
    chrome.tabs.sendMessage(tab.id, { type: map[cmd] || 'toggle' }, () => {
      void chrome.runtime.lastError;
    });
  } catch (e) { /* 忽略 */ }
});

/* 默认值改过的设置，老用户升级时迁移一次；之后用户自己改回去不会被覆盖
   v0.3.1：悬停查词默认键 ⌥ → Ctrl
   v0.3.3：生词高亮默认样式 下划线 → 浅黄色块 */
chrome.runtime.onInstalled.addListener(async () => {
  const st = await chrome.storage.local.get(['settings', 'hoverKeyMigrated', 'hlYellowMigrated']);
  const settings = Object.assign({}, st.settings || {});
  let changed = false;
  if (!st.hoverKeyMigrated && st.settings && (!settings.hoverMode || settings.hoverMode === 'alt')) {
    settings.hoverMode = 'ctrl'; changed = true;
  }
  if (!st.hlYellowMigrated && st.settings && (!settings.hlStyle || settings.hlStyle === 'underline')) {
    settings.hlStyle = 'yellow'; changed = true;
  }
  if (changed) await chrome.storage.local.set({ settings });
  await chrome.storage.local.set({ hoverKeyMigrated: true, hlYellowMigrated: true });
});
