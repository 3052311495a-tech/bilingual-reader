/* 我的双语阅读 · 智能大纲 —— 独立注入，不干扰 content.js
   结构大纲（读标题）+ AI 大纲（DeepSeek 读正文生成），点条目跳转 */
(() => {
  'use strict';

  const HEAD_SEL = 'h1, h2, h3, h4';
  const BLOCK_SEL = 'h1, h2, h3, h4, p';

  const O = { host: null, sh: null, open: false, items: [], busy: false };

  function ensurePanel() {
    if (O.host) return;
    const host = document.createElement('div');
    host.id = 'itt-outline-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;';
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `
      <style>
        *{box-sizing:border-box}
        .panel{
          position:fixed;right:16px;top:72px;width:288px;max-height:72vh;display:flex;flex-direction:column;
          background:#fff;color:#111827;border:1px solid rgba(15,23,42,.1);border-radius:12px;
          box-shadow:0 12px 36px rgba(15,23,42,.18);
          font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;
          overflow:hidden;
        }
        .hd{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid rgba(15,23,42,.08)}
        .hd b{font-size:13px;font-weight:650}
        .hd .sp{flex:1}
        .tabs{display:flex;gap:2px;background:rgba(15,23,42,.05);border-radius:7px;padding:2px}
        .tabs button{
          font:inherit;font-size:11.5px;padding:2px 8px;border:0;border-radius:5px;
          background:transparent;color:#64748b;cursor:pointer
        }
        .tabs button.on{background:#fff;color:#111827;box-shadow:0 1px 2px rgba(15,23,42,.12)}
        .x{border:0;background:transparent;font-size:16px;color:#9ca3af;cursor:pointer;padding:0 2px;line-height:1}
        .x:hover{color:#374151}
        .body{overflow:auto;padding:6px 6px 10px}
        .it{
          padding:5px 9px;border-radius:7px;cursor:pointer;color:#374151;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis
        }
        .it:hover{background:rgba(37,99,235,.08);color:#1d4ed8}
        .it.lv2{padding-left:20px}
        .it.lv3{padding-left:32px}
        .empty,.err{color:#94a3b8;font-size:12px;padding:12px 10px;line-height:1.6}
        .err{color:#b91c1c}
        .ft{padding:8px 12px;border-top:1px solid rgba(15,23,42,.08);color:#9ca3af;font-size:11px}
        @media (prefers-color-scheme: dark){
          .panel{background:#1f2937;color:#e5e7eb;border-color:rgba(255,255,255,.1)}
          .hd{border-color:rgba(255,255,255,.1)}
          .tabs{background:rgba(255,255,255,.06)}
          .tabs button.on{background:#334155;color:#f9fafb}
          .it{color:#cbd5e1}
          .it:hover{background:rgba(96,165,250,.16);color:#bfdbfe}
          .ft{border-color:rgba(255,255,255,.1)}
        }
      </style>
      <div class="panel" hidden>
        <div class="hd">
          <b>智能大纲</b>
          <span class="sp"></span>
          <div class="tabs">
            <button data-m="structure" class="on">结构</button>
            <button data-m="ai">AI 大纲</button>
          </div>
          <button class="x" data-act="close">×</button>
        </div>
        <div class="body"><div class="empty">正在读取页面结构…</div></div>
        <div class="ft">点条目跳转 · Alt+O 开关</div>
      </div>`;

    document.documentElement.appendChild(host);
    O.host = host;
    O.sh = sh;

    sh.querySelector('[data-act="close"]').addEventListener('click', () => toggle(false));
    sh.querySelectorAll('.tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        sh.querySelectorAll('.tabs button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        if (b.dataset.m === 'ai') renderAi();
        else renderStructure();
      });
    });
    sh.querySelector('.body').addEventListener('click', (e) => {
      const it = e.target.closest('.it');
      if (!it) return;
      const idx = Number(it.dataset.i);
      goTo(O.items[idx]);
    });
  }

  function panel() { return O.sh.querySelector('.panel'); }
  function body() { return O.sh.querySelector('.body'); }
  function setMode(m) {
    O.sh.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.m === m));
  }

  function collectHeadings() {
    const out = [];
    for (const el of document.querySelectorAll(HEAD_SEL)) {
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 120) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push({ level: Number(el.tagName[1]) || 1, text, el });
    }
    return out;
  }

  function excerpt() {
    const parts = [];
    let len = 0;
    for (const el of document.querySelectorAll(BLOCK_SEL)) {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      parts.push(t);
      len += t.length;
      if (len > 5000) break;
    }
    return parts.join('\n');
  }

  function paint(items, note) {
    const list = items.map((it, i) => {
      const cls = 'it' + (it.level >= 3 ? ' lv3' : it.level === 2 ? ' lv2' : '');
      return `<div class="${cls}" data-i="${i}" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</div>`;
    }).join('');
    body().innerHTML = (note ? `<div class="empty">${escapeHtml(note)}</div>` : '') + (list || '');
  }

  function renderStructure() {
    const hs = collectHeadings();
    O.items = hs;
    if (!hs.length) {
      paint([], '这页没有可用的标题标签，切到「AI 大纲」让模型读正文来分结构。');
      return;
    }
    paint(hs);
  }

  async function renderAi() {
    if (O.busy) return;
    O.busy = true;
    body().innerHTML = '<div class="empty">AI 正在读正文生成大纲…</div>';
    try {
      const hs = collectHeadings().map(h => ({ level: h.level, text: h.text }));
      const res = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'outline', headings: hs, excerpt: excerpt() }, (r) => {
            if (chrome.runtime.lastError) return resolve({ ok: false, error: '扩展已更新，刷新页面' });
            resolve(r || { ok: false, error: '没有响应' });
          });
        } catch (e) { resolve({ ok: false, error: '扩展已更新，刷新页面' }); }
      });
      if (!res.ok) {
        body().innerHTML = `<div class="err">${escapeHtml(res.error || '生成失败')}</div>`;
        return;
      }
      O.items = res.items.map(it => Object.assign({}, it, { el: findHeading(it.title) }));
      paint(O.items, null);
    } finally {
      O.busy = false;
    }
  }

  /* AI 只给标题，尽力对回页面元素 */
  function findHeading(title) {
    const hs = collectHeadings();
    const t = String(title).replace(/\s+/g, '');
    let best = null, bestScore = 0;
    for (const h of hs) {
      const s = h.text.replace(/\s+/g, '');
      let score = 0;
      if (s === t) score = 3;
      else if (s.includes(t.slice(0, 6)) || t.includes(s.slice(0, 6))) score = 2;
      else {
        const set = new Set(t);
        let hit = 0;
        for (const ch of s) if (set.has(ch)) hit++;
        score = hit / Math.max(8, s.length) > 0.55 ? 1 : 0;
      }
      if (score > bestScore) { bestScore = score; best = h.el; }
    }
    return bestScore >= 2 ? best : null;
  }

  function goTo(item) {
    if (!item) return;
    if (item.el) {
      item.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flash(item.el);
      return;
    }
    const el = findHeading(item.title);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); flash(el); }
  }

  function flash(el) {
    try {
      const prev = el.style.outline;
      el.style.outline = '2px solid rgba(37,99,235,.55)';
      el.style.outlineOffset = '3px';
      setTimeout(() => { el.style.outline = prev; el.style.outlineOffset = ''; }, 1200);
    } catch (e) {}
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function toggle(force) {
    ensurePanel();
    const p = panel();
    const next = typeof force === 'boolean' ? force : !O.open;
    O.open = next;
    p.hidden = !next;
    if (next) {
      setMode('structure');
      renderStructure();
    }
    return O.open;
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === 'toggleOutline') {
      respond({ open: toggle() });
      return true;
    }
    if (msg.type === 'outlineStatus') {
      respond({ open: O.open });
      return true;
    }
    return false;
  });

  /* 快捷键兜底：有些环境 browser.commands 没绑上 */
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault();
      toggle();
    }
  });
})();
