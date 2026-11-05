/* 我的双语阅读 · 设置页 */
const $ = (s) => document.querySelector(s);

const DEFAULTS = {
  provider: 'gemini',
  apiKey: '', geminiBase: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-2.5-flash',
  dsKey: '', dsBase: 'https://api.deepseek.com', dsModel: 'deepseek-chat',
  targetLang: '简体中文',
  autoTranslate: true, highlightWords: true, enableSelection: true,
  enableHover: true, hoverMode: 'ctrl', hoverDelay: 180,
  hlStyle: 'underline', hlToday: true, hlNew: true, hlKnown: true,
  displayMode: 'bilingual'
};

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
const DS_MODELS = ['deepseek-chat', 'deepseek-reasoner'];

let S = Object.assign({}, DEFAULTS);
let WB = {};
let LIB = {};

/* ---------- tabs ---------- */
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('#tab-' + t.dataset.tab).classList.add('active');
    if (t.dataset.tab === 'export') refreshPreview();
  });
});

/* ---------- 读取 / 写入 ---------- */
async function load() {
  const data = await chrome.storage.local.get(['settings', 'wordbook', 'library']);
  const local = (self.__ITT_LOCAL__ && self.__ITT_LOCAL__.settings) || {};
  S = Object.assign({}, DEFAULTS, local, data.settings || {});
  WB = data.wordbook || {};
  LIB = data.library || {};
  fillForm();
  renderWords();
  renderSentences();
  $('#wordCount').textContent = Object.keys(WB).length;
}

function syncProviderGroups() {
  const isDs = $('#provider').value === 'openai';
  $('#group-gemini').hidden = isDs;
  $('#group-openai').hidden = !isDs;
}

function fillForm() {
  $('#provider').value = S.provider === 'openai' ? 'openai' : 'gemini';
  syncProviderGroups();

  $('#apiKey').value = S.apiKey || '';
  $('#geminiBase').value = S.geminiBase || DEFAULTS.geminiBase;
  if (GEMINI_MODELS.indexOf(S.model) >= 0) {
    $('#model').value = S.model;
    $('#modelCustom').hidden = true;
  } else {
    $('#model').value = '__custom__';
    $('#modelCustom').hidden = false;
    $('#modelCustom').value = S.model || '';
  }

  $('#dsKey').value = S.dsKey || '';
  $('#dsBase').value = S.dsBase || DEFAULTS.dsBase;
  if (DS_MODELS.indexOf(S.dsModel) >= 0) {
    $('#dsModel').value = S.dsModel;
    $('#dsModelCustom').hidden = true;
  } else {
    $('#dsModel').value = '__custom__';
    $('#dsModelCustom').hidden = false;
    $('#dsModelCustom').value = S.dsModel || '';
  }

  $('#targetLang').value = S.targetLang;
  $('#autoTranslate').checked = !!S.autoTranslate;
  $('#highlightWords').checked = !!S.highlightWords;
  $('#enableSelection').checked = !!S.enableSelection;
  $('#enableHover').checked = !!S.enableHover;
  if (S.displayMode === 'target') $('#modeTarget').checked = true;
  else $('#modeBilingual').checked = true;

  $('#hoverMode').value = (S.hoverMode === 'auto' ? 'ctrl' : S.hoverMode) || 'ctrl';
  $('#hoverDelay').value = S.hoverDelay || 180;
  $('#hlStyle').value = S.hlStyle || 'underline';
  $('#hlToday').checked = S.hlToday !== false;
  $('#hlNew').checked = S.hlNew !== false;
  $('#hlKnown').checked = S.hlKnown !== false;
}

$('#provider').addEventListener('change', syncProviderGroups);

$('#model').addEventListener('change', () => {
  const custom = $('#model').value === '__custom__';
  $('#modelCustom').hidden = !custom;
  if (custom) $('#modelCustom').focus();
});

$('#dsModel').addEventListener('change', () => {
  const custom = $('#dsModel').value === '__custom__';
  $('#dsModelCustom').hidden = !custom;
  if (custom) $('#dsModelCustom').focus();
});

function bindToggleKey(btnSel, inputSel) {
  $(btnSel).addEventListener('click', () => {
    const el = $(inputSel);
    if (el.type === 'password') { el.type = 'text'; $(btnSel).textContent = '隐藏'; }
    else { el.type = 'password'; $(btnSel).textContent = '显示'; }
  });
}
bindToggleKey('#toggleKey', '#apiKey');
bindToggleKey('#toggleDsKey', '#dsKey');

function collectForm() {
  const provider = $('#provider').value === 'openai' ? 'openai' : 'gemini';
  const model = $('#model').value === '__custom__' ? ($('#modelCustom').value || '').trim() : $('#model').value;
  const dsModel = $('#dsModel').value === '__custom__' ? ($('#dsModelCustom').value || '').trim() : $('#dsModel').value;
  const mode = $('#modeTarget').checked ? 'target' : 'bilingual';
  return {
    provider,
    apiKey: $('#apiKey').value.trim(),
    geminiBase: ($('#geminiBase').value || '').trim() || DEFAULTS.geminiBase,
    model: model || DEFAULTS.model,
    dsKey: $('#dsKey').value.trim(),
    dsBase: ($('#dsBase').value || '').trim() || DEFAULTS.dsBase,
    dsModel: dsModel || DEFAULTS.dsModel,
    targetLang: $('#targetLang').value,
    autoTranslate: $('#autoTranslate').checked,
    highlightWords: $('#highlightWords').checked,
    enableSelection: $('#enableSelection').checked,
    enableHover: $('#enableHover').checked,
    hoverMode: $('#hoverMode').value,
    hoverDelay: Math.max(120, Math.min(1500, Number($('#hoverDelay').value) || 180)),
    hlStyle: $('#hlStyle').value,
    hlToday: $('#hlToday').checked,
    hlNew: $('#hlNew').checked,
    hlKnown: $('#hlKnown').checked,
    displayMode: mode
  };
}

$('#save').addEventListener('click', async () => {
  const next = collectForm();
  await chrome.storage.local.set({ settings: next });
  S = Object.assign({}, S, next);
  setStatus('已保存', 'ok');
  setTimeout(() => setStatus('', ''), 1800);
});

$('#test').addEventListener('click', async () => {
  const next = collectForm();
  await chrome.storage.local.set({ settings: Object.assign({}, S, next) });
  S = Object.assign({}, S, next);
  const who = next.provider === 'openai' ? 'DeepSeek' : 'Gemini';
  setStatus(`正在连接 ${who}…`, '');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'test' });
    if (res && res.ok) setStatus('连上了：' + String(res.text).slice(0, 70), 'ok');
    else setStatus('失败：' + ((res && res.error) || '未知错误'), 'err');
  } catch (e) {
    setStatus('失败：' + (e.message || e), 'err');
  }
});

$('#bench').addEventListener('click', async () => {
  const next = collectForm();
  await chrome.storage.local.set({ settings: Object.assign({}, S, next) });
  S = Object.assign({}, S, next);
  setStatus('测速中（两个服务各打一次小请求）…', '');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'bench' });
    if (!res || !res.ok) { setStatus('测速失败', 'err'); return; }
    const fmt = (r, name) => {
      if (!r) return `${name}: —`;
      if (r.skipped) return `${name}: 未配置`;
      if (r.error) return `${name}: ✗ ${r.error.slice(0, 60)}`;
      return `${name}: ${r.ms} ms`;
    };
    const g = fmt(res.gemini, 'Gemini');
    const d = fmt(res.openai, '兼容/DeepSeek');
    const both = [res.gemini, res.openai].filter(x => x && typeof x.ms === 'number');
    let advice = '';
    if (both.length === 2) {
      const faster = res.gemini.ms <= res.openai.ms ? 'Gemini' : '兼容/DeepSeek';
      advice = ` · 建议用 ${faster}`;
    }
    setStatus(`${g} ｜ ${d}${advice}`, 'ok');
  } catch (e) {
    setStatus('测速失败：' + (e.message || e), 'err');
  }
});

function setStatus(text, cls) {
  const el = $('#status');
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

/* ---------- 生词本 ---------- */
function sortedWords() {
  return Object.values(WB).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

function renderWords() {
  const q = ($('#search').value || '').trim().toLowerCase();
  const list = sortedWords().filter(w => {
    if (!q) return true;
    return (w.word || '').toLowerCase().includes(q) || (w.meaning || '').toLowerCase().includes(q);
  });
  const box = $('#wordList');
  if (!list.length) {
    box.innerHTML = `<div class="empty">${q ? '没有匹配的词' : '还没有生词。阅读时划词或按住 Ctrl 悬停，点「☆ 收藏」就会进来。'}</div>`;
    return;
  }
  box.innerHTML = list.map(w => `
    <div class="word" data-k="${escAttr((w.word || '').toLowerCase())}">
      <div class="w">${escHtml(w.word || '')}${w.state === 'known' ? ' <span class="pill">已学</span>' : ''}<div class="ph">${escHtml(w.phonetic || '')}</div></div>
      <div class="body">
        <div class="mean">${escHtml([w.pos, w.meaning].filter(Boolean).join(' '))}</div>
        ${w.example ? `<div class="meta">${escHtml(w.example)}${w.exampleZh ? ' — ' + escHtml(w.exampleZh) : ''}</div>` : ''}
        <div class="meta">${w.title ? escHtml(w.title) : ''}${w.ts ? ' · ' + new Date(w.ts).toLocaleDateString('zh-CN') : ''}</div>
      </div>
      <button class="del" data-del="${escAttr((w.word || '').toLowerCase())}" title="删除">×</button>
    </div>`).join('');

  box.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const k = btn.dataset.del;
      delete WB[k];
      await chrome.storage.local.set({ wordbook: WB });
      $('#wordCount').textContent = Object.keys(WB).length;
      renderWords();
    });
  });
}

function renderSentences() {
  const list = Object.values(LIB).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const box = $('#sentList');
  $('#sentCount').textContent = list.length;
  if (!list.length) {
    box.innerHTML = '<div class="empty">还没有收藏句子。</div>';
    return;
  }
  box.innerHTML = list.map(w => `
    <div class="word">
      <div class="body">
        <div class="mean">${escHtml(w.dst || '')}</div>
        <div class="src">${escHtml(w.src || '')}</div>
        <div class="meta">${w.title ? escHtml(w.title) : ''}${w.ts ? ' · ' + new Date(w.ts).toLocaleDateString('zh-CN') : ''}</div>
      </div>
      <button class="del" data-del-sent="${escAttr(Object.keys(LIB).find(k => LIB[k] === w) || '')}" title="删除">×</button>
    </div>`).join('');

  box.querySelectorAll('[data-del-sent]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const k = btn.dataset.delSent;
      if (!k) return;
      delete LIB[k];
      await chrome.storage.local.set({ library: LIB });
      renderSentences();
    });
  });
}

$('#search').addEventListener('input', renderWords);

$('#clearAll').addEventListener('click', async () => {
  if (!Object.keys(WB).length) return;
  if (!confirm('清空全部生词？建议先导出再清空。')) return;
  WB = {};
  await chrome.storage.local.set({ wordbook: WB });
  $('#wordCount').textContent = '0';
  renderWords();
});

/* ---------- 导出 ---------- */
function buildMarkdown() {
  const words = sortedWords();
  const now = new Date();
  const stamp = now.toLocaleString('zh-CN', { hour12: false });
  const L = [];

  L.push('# 英语生词本 · 学习包');
  L.push('');
  L.push(`- 生成时间：${stamp}`);
  L.push(`- 词数：${words.length}`);
  L.push(`- 来源：我的浏览器阅读记录（沉浸式阅读扩展导出）`);
  L.push('');
  L.push('## 使用说明（给 NotebookLM 的指令）');
  L.push('');
  L.push('这个文件是我的英语生词本。每个词都记录了释义、例句，以及**我实际读到它的那句原文**（原文语境）——请优先用这一句判断我的理解偏差。');
  L.push('');
  L.push('请这样帮我：');
  L.push('');
  L.push('1. 先通读全部词条，指出哪些词属于同一主题、可以成组记忆。');
  L.push('2. 每次只出 10 道题，先只出题不给答案；我答完再逐题判对错，并说明错因。题型轮换：中译英填空、英译中、用该词造句、根据原文语境猜词。');
  L.push('3. 针对「原文语境」这一栏，指出我当时可能误解的地方。');
  L.push('4. 生成一份 7 天复习表（每天 10 个词，含复习旧词）。');
  L.push('5. 生成 Audio Overview 时，只讲我错得最多的词，语速慢一点。');
  L.push('');
  L.push('---');
  L.push('');
  L.push('## 词条');
  L.push('');

  words.forEach((w, i) => {
    L.push(`### ${i + 1}. ${w.word || ''}${w.phonetic ? '  ' + w.phonetic : ''}`);
    L.push('');
    const mean = [w.pos, w.meaning].filter(Boolean).join(' ');
    if (mean) L.push(`- 释义：${mean}`);
    if (w.example) L.push(`- 例句：${w.example}`);
    if (w.exampleZh) L.push(`- 例句翻译：${w.exampleZh}`);
    if (w.ctx) L.push(`- 原文语境：${w.ctx}`);
    if (w.title || w.url) L.push(`- 出处：${[w.title, w.url].filter(Boolean).join(' — ')}`);
    if (w.ts) L.push(`- 收藏时间：${new Date(w.ts).toLocaleString('zh-CN', { hour12: false })}`);
    L.push('');
  });

  const sents = Object.values(LIB).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (sents.length) {
    L.push('---');
    L.push('');
    L.push('## 收藏句子');
    L.push('');
    L.push('这些是我读的时候特意存下来的句子，比单词更能看出我的语感短板。');
    L.push('');
    sents.forEach((x, i) => {
      L.push(`### 句 ${i + 1}`);
      L.push('');
      L.push(`- 原文：${x.src || ''}`);
      L.push(`- 译文：${x.dst || ''}`);
      if (x.title || x.url) L.push(`- 出处：${[x.title, x.url].filter(Boolean).join(' — ')}`);
      L.push('');
    });
  }

  L.push('---');
  L.push('');
  L.push('## 附：给我的自测清单');
  L.push('');
  L.push('- [ ] 这 10 个词我能不看释义说出中文吗？');
  L.push('- [ ] 我能在句子里用对它们的词性吗？');
  L.push('- [ ] 我能分辨这组里最像的两个词吗？');
  L.push('');
  return L.join('\n');
}

function buildCsv() {
  const head = ['word', 'phonetic', 'pos', 'meaning', 'example', 'exampleZh', 'context', 'title', 'url', 'collected_at'];
  const rows = [head.join(',')];
  for (const w of sortedWords()) {
    rows.push([
      w.word, w.phonetic, w.pos, w.meaning, w.example, w.exampleZh, w.ctx, w.title, w.url,
      w.ts ? new Date(w.ts).toISOString() : ''
    ].map(csvCell).join(','));
  }
  return '\uFEFF' + rows.join('\r\n');
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

function stampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

$('#downloadMd').addEventListener('click', () => {
  if (!Object.keys(WB).length) return alert('生词本是空的，先收藏几个词。');
  download(`生词本-${stampName()}.md`, buildMarkdown(), 'text/markdown;charset=utf-8');
});

$('#copyMd').addEventListener('click', async () => {
  if (!Object.keys(WB).length) return alert('生词本是空的，先收藏几个词。');
  try {
    await navigator.clipboard.writeText(buildMarkdown());
    setStatus('已复制，去 NotebookLM 里 Add source → Copied text 粘贴', 'ok');
  } catch (e) {
    setStatus('复制失败：' + (e.message || e), 'err');
  }
});

$('#downloadCsv').addEventListener('click', () => {
  if (!Object.keys(WB).length) return alert('生词本是空的，先收藏几个词。');
  download(`生词本-${stampName()}.csv`, buildCsv(), 'text/csv;charset=utf-8');
});

$('#exportCsvInline').addEventListener('click', () => $('#downloadCsv').click());

function refreshPreview() {
  const md = buildMarkdown();
  $('#preview').textContent = md.slice(0, 4000) + (md.length > 4000 ? '\n\n…（预览截断，下载/复制是完整的）' : '');
  $('#previewMeta').textContent = `${Object.keys(WB).length} 个词 · ${Object.keys(LIB).length} 句 · ${md.length} 字符`;
}

$('#refreshPreview').addEventListener('click', refreshPreview);

/* ---------- 工具 ---------- */
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function escAttr(s) { return escHtml(s); }

load().then(() => {
  const initial = (location.hash || '').replace('#', '');
  if (initial === 'words' || initial === 'export') {
    const t = document.querySelector(`.tab[data-tab="${initial}"]`);
    if (t) t.click();
  }
});
