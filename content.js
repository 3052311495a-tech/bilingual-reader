/* 我的双语阅读 · Gemini — 内容脚本
   1) 段落双语 / 纯译文  2) Ctrl 悬停查词  3) 划词翻译  4) 生词高亮 + 收藏 */
(() => {
  'use strict';

  const DEFAULTS = {
    apiKey: '', model: 'gemini-2.5-flash', targetLang: '简体中文',
    autoTranslate: true, highlightWords: true, enableSelection: true,
    enableHover: true, hoverMode: 'ctrl', hoverDelay: 120,
    hlStyle: 'yellow', hlToday: true, hlNew: true, hlKnown: true,
    showBall: true, ballTop: 0.42,
    displayMode: 'bilingual'
  };
  const BLOCK_SEL = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, figcaption, td, th, summary';

  /* 站点适配：有些站点的正文不是语义标签，得按 data-testid 抓
     sel  = 正文容器（整块交给分段逻辑，内部按段落插译文）
     skip = 这个站点上不翻译的区域（侧栏、导航之类）
     only = true 时只翻 sel 里的正文容器，页面上别的 h1/h2/li 一律当界面文字（X 顶栏的「Post」「Explore」就是 h2） */
  const SITE_ADAPTERS = [
    {
      host: /(^|\.)(x|twitter)\.com$/i,
      sel: '[data-testid="tweetText"], [data-testid="twitterArticleRichTextView"], [data-testid="UserDescription"]',
      skip: '[data-testid="sidebarColumn"], [data-testid="trend"], [role="tablist"], [data-testid="DMDrawer"]',
      only: true
    }
  ];

  /* 页面「外壳」：导航、菜单、页眉页脚、读屏专用文字，统统不翻 */
  const CHROME_SEL = 'nav, [role="navigation"], [role="menu"], [role="menubar"], [role="menuitem"], [role="tablist"], [role="tab"], ' +
    '[role="toolbar"], [role="banner"], [role="contentinfo"], [role="search"], [role="dialog"][aria-modal="true"] nav, ' +
    '[aria-hidden="true"], .sr-only, .visually-hidden, .screen-reader-text, .a11y-hidden';
  const MAIN_SEL = 'main, article, [role="main"], [role="article"]';

  const activeAdapters = () => SITE_ADAPTERS.filter(a => a.host.test(location.hostname));

  function blockSelector() {
    const ads = activeAdapters();
    if (ads.some(a => a.only)) return ads.map(a => a.sel).join(', ');
    const extra = ads.map(a => a.sel);
    return extra.length ? BLOCK_SEL + ', ' + extra.join(', ') : BLOCK_SEL;
  }

  function siteSel() { return activeAdapters().map(a => a.sel).join(', '); }

  /* 本身就是站点正文容器 */
  function isSiteBlock(el) {
    const sel = siteSel();
    return !!(sel && el.matches && el.matches(sel));
  }

  /* 在站点正文容器里面的子元素（交给外层容器统一分段，别重复翻） */
  function insideSiteBlock(el) {
    const sel = siteSel();
    return !!(sel && el.parentElement && el.parentElement.closest(sel));
  }

  /* ---------- 语言判断：已经是目标语言的就不翻 ---------- */
  function countRe(t, re) { const m = t.match(re); return m ? m.length : 0; }

  function langStats(t) {
    return {
      han: countRe(t, /\p{Script=Han}/gu),
      kana: countRe(t, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu),
      hangul: countRe(t, /\p{Script=Hangul}/gu),
      latin: countRe(t, /\p{Script=Latin}/gu)
    };
  }

  function targetKind() {
    const l = String((S.settings && S.settings.targetLang) || '简体中文');
    if (/日本|japan/i.test(l)) return 'ja';
    if (/한국|韩|korea/i.test(l)) return 'ko';
    if (/english|英/i.test(l)) return 'en';
    return 'zh';
  }

  /* 一个汉字的信息量大约顶 4~5 个拉丁字母，所以按加权比较 */
  function isTargetLang(t) {
    const s = langStats(t);
    const cjk = s.han + s.kana + s.hangul;
    switch (targetKind()) {
      case 'zh': return s.kana === 0 && s.han >= 2 && s.han * 4 >= s.latin;
      case 'ja': return s.kana >= 2 && cjk * 4 >= s.latin;
      case 'ko': return s.hangul >= 2 && s.hangul * 4 >= s.latin;
      case 'en': return cjk === 0 || s.latin >= cjk * 8;
    }
    return false;
  }

  const S = {
    settings: null,
    words: new Map(),
    on: false,
    mode: 'bilingual',
    queue: [],
    blocks: new Set(),
    alignCache: new Map(),
    timer: null,
    inflight: 0,
    trCache: new Map(),
    knowCache: new Map(),
    io: null,
    host: null,
    shadow: null,
    card: null,
    cardOpen: false,
    hover: { timer: null, word: '', x: 0, y: 0, hideTimer: null },
    mouse: { x: -1, y: -1 },
    lookupSeq: 0,
    hoverActive: false,
    dragging: false,
    lastErr: null,
    lastHref: location.href
  };

  /* ================= 基础 ================= */
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function textOf(el) {
    const t = el.innerText || el.textContent || '';
    return t.replace(/\s+/g, ' ').trim();
  }

  async function loadState() {
    const { settings, wordbook } = await chrome.storage.local.get(['settings', 'wordbook']);
    S.settings = Object.assign({}, DEFAULTS, settings || {});
    S.words = new Map(Object.entries(wordbook || {}));
    S.mode = S.settings.displayMode === 'target' ? 'target' : 'bilingual';
    applyModeClass();
    applyHlStyle();
  }

  function applyModeClass() {
    const el = document.documentElement;
    el.classList.toggle('itt-on', !!S.on);
    el.classList.toggle('itt-mode-target', S.mode === 'target');
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      S.settings = Object.assign({}, DEFAULTS, changes.settings.newValue || {});
      S.mode = S.settings.displayMode === 'target' ? 'target' : 'bilingual';
      applyModeClass();
      applyHlStyle();
      if (S.settings.showBall === false) { if (ballEl) { ballEl.host.remove(); ballEl = null; } }
      else ensureBall();
      if (S.on) { highlightWords(); remarkAllSlots(); }
    }
    if (changes.wordbook) {
      S.words = new Map(Object.entries(changes.wordbook.newValue || {}));
      if (S.settings && S.settings.highlightWords) highlightWords();
      remarkAllSlots();
    }
  });

  /* ================= 整页翻译 =================
     思路跟沉浸式翻译一致：一段原文 → 紧跟一段译文 → 下一段原文。
     - 普通网页：<p>/<li> 等本来就是一段一个元素，译文插在元素后面
     - X 推文 / X 长文：整个正文是一个容器，内部按「空行 / <br><br> / 块级子元素」切成段落，
       每段的译文插在该段末尾（必要时切开文本节点）
     - 一块里的每段都是独立的翻译单元（unit），各自排队、各自回填 */

  const LONG_BLOCK = 280;     // 低于这个字数的推文：整条译文放在最后，不逐段插
  const SHORT_PARA = 60;      // 很短的段落（单行列表、口号句）会和相邻短段合并
  const MERGE_LIMIT = 160;    // 合并后的上限

  function isGoodBlock(el) {
    if (!el || el.dataset.itt === '1') return false;
    if (el.closest('.itt-tr, #itt-card-host, #itt-ball-host, pre, code, kbd, samp, textarea, select, option, svg, canvas, script, style, noscript, [contenteditable=""], [contenteditable="true"]')) return false;
    if (el.isContentEditable) return false;
    if (el.closest(CHROME_SEL)) return false;
    for (const a of activeAdapters()) if (a.skip && el.closest(a.skip)) return false;
    // header/footer/aside 只在正文区之外才算「外壳」（文章内的 <header><h1> 要翻）
    if (!el.closest(MAIN_SEL) && el.closest('header, footer, aside, [role="complementary"]')) return false;
    const site = isSiteBlock(el);
    if (!site && activeAdapters().some(a => a.only)) return false;
    if (!site && insideSiteBlock(el)) return false;
    if (!site && el.querySelector('p, li, blockquote, table, ul, ol')) return false;
    const t = textOf(el);
    if (t.length < 2 || t.length > (site ? 40000 : 6000)) return false;
    if (!/[\p{L}]/u.test(t)) return false;
    if (isTargetLang(t)) return false;
    // 短小的纯链接条目（菜单、标签云、目录）不翻
    if (/^(LI|DT|DD|TD|TH|SUMMARY)$/.test(el.tagName) && t.length < 60) {
      let linkLen = 0;
      el.querySelectorAll('a, button').forEach(a => { linkLen += (a.textContent || '').replace(/\s+/g, ' ').trim().length; });
      if (linkLen >= t.length * 0.85) return false;
    }
    return true;
  }

  /* 读屏专用的隐藏文字（X 左上角那句「要查看键盘快捷键…」就是这种）：1px 大小 / clip / 透明 */
  function isVisuallyHidden(el, rect) {
    if (!rect || rect.width < 4 || rect.height < 4) return true;
    let n = el;
    for (let i = 0; n && n !== document.body && i < 5; i++, n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.opacity === '0') return true;
      if ((cs.position === 'absolute' || cs.position === 'fixed') && cs.clip && cs.clip !== 'auto') return true;
      if (cs.clipPath && /inset\(\s*50%|circle\(\s*0/.test(cs.clipPath)) return true;
      if (i > 0 && cs.overflow === 'hidden') {
        const r = n.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return true;
      }
    }
    return false;
  }

  /* ---------- 把一个块切成段落 ----------
     token：{t:'x', s, node} 文字；{t:'nl', ref} 软换行（单个 \n 或 <br>）；{t:'blk', el} 块级元素结束
     块级与否看实际渲染的 display，不看标签名：X 会把链接包在 display:inline 的 div 里，
     按标签算会把一句话从链接处切成两段 */
  function displayOf(el) {
    try { return getComputedStyle(el).display; } catch (e) { return 'inline'; }
  }
  const isInlineDisplay = (d) => d.startsWith('inline') || d === 'contents' || d.startsWith('ruby');
  /* 「原子」行内盒：inline-block / inline-flex / inline-grid / inline-table。里面的东西整体是一个行内块，
     块级子元素也不会另起一行。普通 inline 不算——块级元素放在普通 inline 里照样独占一行 */
  const isAtomicInline = (d) => d.startsWith('inline-') || d.startsWith('ruby');

  /* inInline：已经在一个原子行内盒（inline-flex / inline-block…）里面了。
     X 的 @提及 包在 inline-flex 的 div 里，浏览器会把弹性容器的子元素强制算成 block，
     只看子元素自己的 display 就会误判成段落边界，把一句话从 @ 处切断 */
  function tokenize(root, textNewlines) {
    const toks = [];
    (function walk(node, inInline) {   // inInline：是否在原子行内盒里
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          const v = c.nodeValue || '';
          if (!textNewlines || v.indexOf('\n') < 0) { toks.push({ t: 'x', s: v, node: c }); continue; }
          let last = 0;
          for (let i = 0; i < v.length; i++) {
            if (v[i] !== '\n') continue;
            if (i > last) toks.push({ t: 'x', s: v.slice(last, i), node: c });
            toks.push({ t: 'nl', ref: { text: c, off: i + 1 } });
            last = i + 1;
          }
          if (last < v.length) toks.push({ t: 'x', s: v.slice(last), node: c });
        } else if (c.nodeType === 1) {
          if (c.classList.contains('itt-tr')) continue;
          const tag = c.tagName;
          if (tag === 'BR') { toks.push({ t: 'nl', ref: { after: c } }); continue; }
          if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|BUTTON)$/i.test(tag)) continue;
          if (c.getAttribute('aria-hidden') === 'true') continue;
          const d = displayOf(c);
          if (d === 'none') continue;
          if (tag === 'IMG') { if (c.alt && c.alt.length <= 4) toks.push({ t: 'x', s: c.alt, node: c }); continue; }
          if (d === 'contents') { walk(c, inInline); continue; }
          // 代码块不翻：整块跳过，前后算段落边界（译文插在代码块前面，不会插进代码里）
          if (tag === 'PRE' || (tag === 'CODE' && !isInlineDisplay(d)) || /code-?block/i.test(c.getAttribute('data-testid') || '')) {
            toks.push({ t: 'brk', ref: { before: c } });
            toks.push({ t: 'brk', ref: { after: c } });
            continue;
          }
          // 标题前后永远是段落边界，不管包在什么容器里（@提及 里不可能有标题）
          const heading = /^H[1-6]$/.test(tag) || c.getAttribute('role') === 'heading';
          if (heading) toks.push({ t: 'brk', ref: { before: c } });
          walk(c, inInline || isAtomicInline(d));
          if ((!isInlineDisplay(d) && !inInline) || heading) toks.push({ t: 'blk', el: c });
        }
      }
    })(root, false);
    return toks;
  }

  /* → [{text, end, src}]
     end = 这一段译文的插入点：
       - 段后跟着块级边界 → 插进「包住这段的最内层块」的末尾（{append: el}），
         译文就在段落自己的盒子里，间距跟原文段落一致，不会被外层 margin 撑开
       - 段后只是空行 / <br><br> → 插在第一个换行后面（{ref}），空行留在译文和下一段之间
       - 段后什么都没有（块里最后一段）→ null，交给 insertTranslationEl
     src = 段落第一个文字所在的元素，译文的字号字体照它抄 */
  function paragraphs(root, textNewlines) {
    const toks = tokenize(root, textNewlines);
    const paras = [];
    let cur = '', src = null, runFirstNl = null, runFirstBlk = null, runFirstBrk = null, nlRun = 0, hard = false;
    const norm = (s) => s.split('\n').map(x => x.replace(/[ \t\u00a0\r\f\v]+/g, ' ').trim()).filter(Boolean).join('\n');
    const close = (end) => {
      const t = norm(cur);
      if (t && /[\p{L}]/u.test(t)) paras.push({ text: t, end, src });
      cur = ''; src = null;
    };
    const runEnd = () => runFirstBlk ? { append: runFirstBlk } : runFirstBrk ? { ref: runFirstBrk } : (runFirstNl ? { ref: runFirstNl } : null);
    for (const k of toks) {
      if (k.t === 'x') {
        if (!k.s.trim()) { if (cur) cur += k.s; continue; }
        if (nlRun) {
          if (hard || nlRun >= 2) close(runEnd());
          else if (cur) cur += '\n';
        }
        if (!cur.trim()) src = k.node ? k.node.parentElement : null;
        nlRun = 0; hard = false; runFirstNl = null; runFirstBlk = null; runFirstBrk = null;
        cur += k.s;
      } else {
        if (k.t === 'blk') { hard = true; if (!runFirstBlk) runFirstBlk = k.el; }
        else if (k.t === 'brk') { hard = true; if (!runFirstBrk && !runFirstBlk) runFirstBrk = k.ref; }
        else if (!runFirstNl && !runFirstBlk) runFirstNl = k.ref;
        nlRun++;
      }
    }
    // 最后一段：后面紧跟块级边界（X 长文的最后一个段落 div）也插进那个块里
    close(runFirstBlk ? { append: runFirstBlk } : null);
    return paras;
  }

  /* 段落 → 翻译单元：短推文整条一个单元；长文逐段，过短的相邻段合并。
     单元的插入点 = 组里最后一段的 end，字体来源 = 组里第一段的 src */
  function groupParas(paras) {
    const total = paras.reduce((n, p) => n + p.text.length, 0);
    if (paras.length <= 1 || total < LONG_BLOCK) {
      return paras.length ? [{ text: paras.map(p => p.text).join('\n'), end: null, src: paras[0].src }] : [];
    }
    const groups = [];
    let g = null;
    for (const p of paras) {
      const same = isTargetLang(p.text);
      if (g && g.same === same && g.lastLen < SHORT_PARA && p.text.length < SHORT_PARA && g.text.length + p.text.length < MERGE_LIMIT) {
        g.text += '\n' + p.text;
        g.lastLen = p.text.length;
        g.end = p.end;
        continue;
      }
      g = { text: p.text, end: p.end, src: p.src, lastLen: p.text.length, same };
      groups.push(g);
    }
    return groups;
  }

  function makeSlot(block, site, src) {
    const s = document.createElement(site ? 'span' : 'div');
    s.className = 'itt-tr itt-slot' + (site ? ' itt-x' : '');
    s.setAttribute('translate', 'no');
    try { copyTypography(src && block.contains(src) ? src : block, block, s); } catch (e) {}
    return s;
  }

  /* 中文无衬线字体链：mac 苹方 → Windows 雅黑 → Linux 思源/Noto */
  const CJK_SANS = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "WenQuanYi Micro Hei"';
  const GENERIC_FAMILY = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong)$/i;

  /* 译文沿用原文的字体/字号/颜色/字重（X 的字体写在推文元素自己身上，插在外面的译文继承不到，
     会退回浏览器默认衬线体 → 中文变宋体）。原字体链里去掉 serif 这类通用族，
     否则中文会在通用族那一步匹配到宋体，轮不到后面的苹方/雅黑 */
  function copyTypography(textEl, root, slot) {
    // 字号、字体看文字本身；字重、颜色看它所在的段落块（第一个词是粗体或链接时，整段译文别跟着变粗变蓝）
    let blk = textEl;
    while (blk && blk !== root) {
      // 自己是块级、父元素也不是行内级容器，才算「段落块」（@提及 里被强制 block 的 span 不算）
      const pd = blk.parentElement ? displayOf(blk.parentElement) : 'block';
      if (!isInlineDisplay(displayOf(blk)) && !isAtomicInline(pd)) break;
      blk = blk.parentElement;
    }
    blk = blk || root;
    const ct = getComputedStyle(textEl), cb = getComputedStyle(blk);
    const fams = cb.fontFamily.split(',').map(f => f.trim()).filter(f => f && !GENERIC_FAMILY.test(f.replace(/["']/g, '')));
    const fs = parseFloat(ct.fontSize) || 16;
    const lh = parseFloat(cb.lineHeight);
    const st = slot.style;
    st.setProperty('--itt-ff', [...fams, CJK_SANS, 'sans-serif'].join(', '));
    st.setProperty('--itt-fs', fs + 'px');
    st.setProperty('--itt-color', cb.color);
    st.setProperty('--itt-fw', cb.fontWeight);
    // 中文比英文需要更松一点的行距；原文行距本来就大（标题）就按原文
    st.setProperty('--itt-lh', Math.max(Number.isFinite(lh) ? Math.min(lh, fs * 2) : 0, fs * 1.6) + 'px');
  }

  /* 在 ref 处插入元素；切开的文本节点记下来，清理时拼回去（React 还拿着前半截的引用） */
  function insertAtRef(ref, el) {
    if (ref.append) { ref.append.appendChild(el); return; }
    if (ref.after) { ref.after.after(el); return; }
    if (ref.before) { ref.before.before(el); return; }
    const tn = ref.text;
    if (ref.off >= tn.length) { tn.after(el); return; }
    const rest = tn.splitText(ref.off);
    rest.before(el);
    el._ittJoin = [tn, rest, tn.length];
  }

  function insertTranslationEl(block, el) {
    const tag = block.tagName;
    if (!isSiteBlock(block) && /^(TD|TH|LI|DD|DT|BLOCKQUOTE|SUMMARY)$/.test(tag)) {
      block.appendChild(el);
      block.dataset.ittInner = '1';
    } else {
      block.insertAdjacentElement('afterend', el);
    }
  }

  function blockSig(block) {
    let n = (block.textContent || '').length;
    for (const s of block._ittSlots || []) if (block.contains(s)) n -= (s.textContent || '').length;
    return n;
  }

  /* 准备一个块：切段、插好隐藏的占位，返回要翻译的单元 */
  function prepareBlock(block) {
    const site = isSiteBlock(block);
    const groups = groupParas(paragraphs(block, site));
    if (!groups.length || !groups.some(g => !isTargetLang(g.text))) return [];

    const slots = groups.map(g => makeSlot(block, site, g.src));
    // 从后往前插：同一个文本节点被切多次时，前面的偏移量不受影响
    for (let i = groups.length - 1; i >= 0; i--) {
      const end = groups[i].end;
      if (!end) { insertTranslationEl(block, slots[i]); continue; }
      insertAtRef(end.append ? end : end.ref, slots[i]);
      slots[i].classList.add('itt-tight');
      block.dataset.ittInner = '1';
    }
    block._ittSlots = slots;
    block.dataset.itt = '1';
    S.blocks.add(block);

    const units = [];
    groups.forEach((g, i) => {
      if (isTargetLang(g.text)) {
        // 本来就是中文的段落：不翻，纯译文模式下照原样显示
        slots[i].textContent = g.text;
        slots[i].classList.remove('itt-slot');
        slots[i].classList.add('itt-same');
      } else {
        slots[i]._ittSrc = g.text;
        units.push({ block, slot: slots[i], text: g.text });
      }
    });
    block._ittSig = blockSig(block);
    return units;
  }

  function cleanupBlock(block) {
    for (const s of block._ittSlots || []) {
      clearTimeout(s._ittTimer);
      s.remove();
      const j = s._ittJoin;
      if (j) {
        const [a, b, aLen] = j;
        if (b.isConnected && a.isConnected && a.nextSibling === b) {
          if (a.length === aLen) a.appendData(b.data);
          b.remove();
        }
      }
    }
    block._ittSlots = null;
    block._ittSig = null;
    delete block.dataset.itt;
    delete block.dataset.ittInner;
    delete block.dataset.ittSeen;
    S.blocks.delete(block);
  }

  /* X 是 React：重渲染会删掉译文或改掉原文，检测到就清掉重翻（命中缓存，瞬间完成） */
  function needsRedo(block) {
    const slots = block._ittSlots || [];
    if (slots.some(s => !s.isConnected)) return true;
    return blockSig(block) !== block._ittSig;
  }

  function collect() {
    if (!document.body) return;
    for (const b of [...S.blocks]) {
      if (!b.isConnected) { S.blocks.delete(b); continue; }
      if (needsRedo(b)) cleanupBlock(b);
    }
    if (!S.io) {
      S.io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target;
          S.io.unobserve(el);
          if (el.dataset.itt === '1') continue;
          if (isVisuallyHidden(el, e.boundingClientRect)) continue;
          if (!isGoodBlock(el)) continue;
          const units = prepareBlock(el);
          if (!units.length) continue;
          S.queue.push(...units);
          schedule();
        }
      }, { rootMargin: '400px 0px' });
    }
    let nodes;
    try { nodes = document.querySelectorAll(blockSelector()); } catch (e) { return; }
    let n = 0;
    for (const el of nodes) {
      if (n++ > 2000) break;
      if (el.dataset.itt === '1' || el.dataset.ittSeen === '1') continue;
      el.dataset.ittSeen = '1';
      if (!isGoodBlock(el)) continue;
      S.io.observe(el);
    }
  }

  function schedule() {
    if (S.timer) return;
    S.timer = setTimeout(() => { S.timer = null; flush(); }, 120);
  }

  /* 一次请求最多 6 段 / 2400 字，最多 3 个请求并行；队列按出现顺序，自上而下 */
  async function flush() {
    if (!S.on || !S.queue.length) return;
    if (S.inflight >= 3) return;
    const batch = [];
    let len = 0;
    while (S.queue.length && batch.length < 6 && len < 2400) {
      const u = S.queue.shift();
      if (!u.slot.isConnected) continue;
      batch.push(u);
      len += u.text.length;
    }
    if (!batch.length) return;
    S.inflight++;
    if (S.queue.length) schedule();
    try {
      for (const u of batch) armPending(u.slot);
      const need = [...new Set(batch.map(u => u.text))].filter(t => !S.trCache.has(t));
      if (need.length) {
        const res = await sendBg({ type: 'translate', texts: need });
        if (!res || !res.ok) notifyError(res);
        else for (const [k, v] of Object.entries(res.results || {})) S.trCache.set(k, v);
      }
      for (const u of batch) {
        const v = S.trCache.get(u.text);
        if (v) fillSlot(u.slot, v);
        else { clearTimeout(u.slot._ittTimer); u.slot.textContent = ''; u.slot.classList.remove('itt-pending'); u.slot.classList.add('itt-slot'); }
      }
    } finally {
      S.inflight--;
      if (S.queue.length) schedule();
    }
  }

  /* 慢链路：超过 700ms 还没回来就先占位，别让页面看着像没反应 */
  function armPending(slot) {
    clearTimeout(slot._ittTimer);
    slot._ittTimer = setTimeout(() => {
      if (!slot.classList.contains('itt-slot')) return;
      slot.classList.remove('itt-slot');
      slot.classList.add('itt-pending');
      slot.textContent = '翻译中…';
    }, 700);
  }

  function fillSlot(slot, text) {
    clearTimeout(slot._ittTimer);
    slot.textContent = text;
    slot._ittDst = text;
    slot.classList.remove('itt-slot', 'itt-pending');
    if (S.words.size) markSlot(slot);
  }

  function translatedCount() {
    return document.querySelectorAll('.itt-tr:not(.itt-slot):not(.itt-pending):not(.itt-same)').length;
  }

  function enable() {
    if (S.on) return;
    S.on = true;
    applyModeClass();
    collect();
    highlightWords();
    updateBall();
  }

  function disable() {
    S.on = false;
    document.documentElement.classList.remove('itt-on');
    if (S.io) { S.io.disconnect(); S.io = null; }
    S.queue.length = 0;
    for (const b of [...S.blocks]) cleanupBlock(b);
    document.querySelectorAll('.itt-tr').forEach(n => n.remove());
    document.querySelectorAll('[data-itt="1"], [data-itt-seen="1"], [data-itt-inner="1"]').forEach(n => {
      delete n.dataset.itt; delete n.dataset.ittSeen; delete n.dataset.ittInner;
    });
    unwrapHighlights();
    hideCard();
    updateBall();
  }

  function toggle() {
    if (S.on) disable(); else enable();
    updateBall();
    return S.on;
  }

  function cycleMode() {
    S.mode = S.mode === 'bilingual' ? 'target' : 'bilingual';
    applyModeClass();
    if (S.settings) {
      chrome.storage.local.set({ settings: Object.assign({}, S.settings, { displayMode: S.mode }) }).catch(() => {});
    }
    toast(S.mode === 'target' ? '纯译文模式' : '双语对照模式');
    return S.mode;
  }

  /* ================= 与后台通信 ================= */
  function sendBg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            return resolve({ ok: false, error: '扩展已更新，刷新页面后再试' });
          }
          resolve(res || { ok: false, error: '没有响应' });
        });
      } catch (e) {
        resolve({ ok: false, error: '扩展已更新，刷新页面后再试' });
      }
    });
  }

  function notifyError(res) {
    const err = (res && res.error) || '翻译失败';
    const now = Date.now();
    if (S.lastErr && S.lastErr.sig === String(err) && now - S.lastErr.at < 20000) return;
    S.lastErr = { sig: String(err), at: now };
    if (res && (res.code === 'NO_KEY' || res.code === 'BAD_KEY')) {
      toast(err, { action: '打开设置', onAction: () => sendBg({ type: 'openOptions' }) });
    } else {
      toast(err);
    }
  }

  /* ================= 生词高亮 ================= */
  function isToday(ts) {
    const d = new Date(ts || 0), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  }

  /* 今日单词 / 生词 / 已学 */
  function categoryOf(key) {
    const w = S.words.get(key);
    if (!w) return null;
    const st = S.settings || {};
    if (w.state === 'known') return st.hlKnown === false ? null : 'known';
    if (isToday(w.ts)) return st.hlToday === false ? null : 'today';
    return st.hlNew === false ? null : 'new';
  }

  function applyHlStyle() {
    const el = document.documentElement;
    const style = (S.settings && S.settings.hlStyle) || 'yellow';
    el.classList.toggle('itt-hlstyle-yellow', style === 'yellow');
    el.classList.toggle('itt-hlstyle-bg', style === 'bg');
    el.classList.toggle('itt-hlstyle-line', style === 'underline');
    el.classList.toggle('itt-hlstyle-linebg', style === 'underline-bg');
  }

  function unwrapHighlights() {
    document.querySelectorAll('mark.itt-hl:not(.itt-hl-zh)').forEach(m => {
      const t = document.createTextNode(m.textContent);
      m.replaceWith(t);
    });
  }

  const SUFFIX = '(?:s|es|ed|d|ing|ies|ied)?';
  function wordRegex(keys) {
    return new RegExp('(?<![A-Za-z])(?:' + keys.map(escapeRe).join('|') + ')' + SUFFIX + '(?![A-Za-z])', 'gi');
  }

  /* 匹配到的词形 → 生词本里的原形 */
  function keyOfMatch(w) {
    const k = String(w).toLowerCase();
    if (S.words.has(k)) return k;
    const tries = [[/ies$/, 'y'], [/ied$/, 'y'], [/ing$/, ''], [/ing$/, 'e'], [/ed$/, ''], [/ed$/, 'e'], [/d$/, ''], [/es$/, ''], [/s$/, '']];
    for (const [re, rep] of tries) {
      if (!re.test(k)) continue;
      const base = k.replace(re, rep);
      if (S.words.has(base)) return base;
    }
    return k;
  }

  /* 一段英文里出现了哪些「不懂」的词（今日 / 生词；已学的不算） */
  function unknownWordsIn(text) {
    const keys = [...S.words.keys()].filter(w => w && w.length > 1 && /^[a-z]/i.test(w));
    if (!keys.length || !text) return [];
    let re;
    try { re = wordRegex(keys.sort((a, b) => b.length - a.length)); } catch (e) { return []; }
    const out = new Map();
    let m;
    while ((m = re.exec(text))) {
      const k = keyOfMatch(m[0]);
      const cat = categoryOf(k);
      if (cat && cat !== 'known' && !out.has(k)) out.set(k, cat);
    }
    return [...out].map(([key, cat]) => ({ key, cat }));
  }

  /* ---------- 译文里给生词对应的中文加高亮 ----------
     先用生词本里存的释义去译文里找（免费、瞬间）；找不到再让模型指出译文里对应的片段（很小的请求，有缓存） */
  function meaningCandidates(meaning) {
    return String(meaning || '')
      .replace(/[（(][^）)]*[）)]/g, ' ')
      .replace(/\b(?:n|v|vt|vi|adj|adv|prep|conj|pron|phr|abbr)\./gi, ' ')
      .split(/[；;，,、\/|\s]+|或/)
      .map(t => t.replace(/^(?:使|被|把)|的$|地$/g, '').trim())
      .filter(t => t.length >= 2 && /\p{Script=Han}/u.test(t))
      .sort((a, b) => b.length - a.length);
  }

  function findZh(key, dst) {
    const ck = key + '\u0001' + dst;
    if (S.alignCache.has(ck)) return S.alignCache.get(ck);
    const w = S.words.get(key) || {};
    for (const c of meaningCandidates(w.meaning)) if (dst.indexOf(c) >= 0) return c;
    return undefined;   // 未知，要问模型
  }

  function renderSlotMarks(slot) {
    const dst = slot._ittDst;
    if (!dst) return;
    const spans = [];
    for (const { key, cat } of slot._ittWords || []) {
      const zh = S.alignCache.get(key + '\u0001' + dst) || findZh(key, dst);
      if (zh) spans.push({ zh, key, cat });
    }
    if (!spans.length) {
      if (slot.querySelector('mark')) slot.textContent = dst;
      return;
    }
    // 找出所有出现位置，按位置排序、去重叠
    const hits = [];
    for (const sp of spans) {
      let i = dst.indexOf(sp.zh);
      while (i >= 0) { hits.push({ i, j: i + sp.zh.length, sp }); i = dst.indexOf(sp.zh, i + sp.zh.length); }
    }
    hits.sort((a, b) => a.i - b.i || b.j - a.j);
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const h of hits) {
      if (h.i < last) continue;
      if (h.i > last) frag.appendChild(document.createTextNode(dst.slice(last, h.i)));
      const mk = document.createElement('mark');
      mk.className = 'itt-hl itt-hl-zh itt-cat-' + h.sp.cat;
      mk.dataset.w = h.sp.key;
      mk.textContent = dst.slice(h.i, h.j);
      frag.appendChild(mk);
      last = h.j;
    }
    if (last < dst.length) frag.appendChild(document.createTextNode(dst.slice(last)));
    slot.textContent = '';
    slot.appendChild(frag);
  }

  async function markSlot(slot) {
    if (!slot || !slot._ittDst || !slot.isConnected) return;
    if (!S.settings || !S.settings.highlightWords) { slot._ittWords = []; renderSlotMarks(slot); return; }
    slot._ittWords = unknownWordsIn(slot._ittSrc || '');
    renderSlotMarks(slot);
    const dst = slot._ittDst;
    const missing = slot._ittWords.map(w => w.key).filter(k => findZh(k, dst) === undefined);
    if (!missing.length) return;
    const res = await sendBg({ type: 'align', src: slot._ittSrc, dst, words: missing });
    const map = (res && res.ok && res.map) || {};
    for (const k of missing) {
      const zh = map[k];
      S.alignCache.set(k + '\u0001' + dst, zh && dst.indexOf(zh) >= 0 ? zh : null);
    }
    if (slot.isConnected && slot._ittDst === dst) renderSlotMarks(slot);
  }

  /* 生词本变了：页面上已经出来的译文全部重新标一遍 */
  function remarkAllSlots() {
    for (const b of S.blocks) for (const sl of b._ittSlots || []) if (sl._ittDst) markSlot(sl);
  }

  function highlightWords() {
    if (!S.settings || !S.settings.highlightWords) { unwrapHighlights(); return; }
    applyHlStyle();
    unwrapHighlights();
    const keys = [...S.words.keys()].filter(w => w && w.length > 1).sort((a, b) => b.length - a.length);
    if (!keys.length) return;

    let re;
    try {
      re = wordRegex(keys);
    } catch (e) { return; }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest('script, style, noscript, pre, code, kbd, samp, textarea, mark.itt-hl, .itt-tr, #itt-card-host, [contenteditable=""], [contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
        const v = n.nodeValue;
        if (!v || v.length < 2 || !/[A-Za-z]/.test(v)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const targets = [];
    let node;
    while ((node = walker.nextNode()) && targets.length < 800) {
      re.lastIndex = 0;
      if (re.test(node.nodeValue)) targets.push(node);
    }

    for (const tn of targets) {
      const text = tn.nodeValue;
      const frag = document.createDocumentFragment();
      let last = 0, m;
      re.lastIndex = 0;
      while ((m = re.exec(text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const key = keyOfMatch(m[0]);
        const cat = categoryOf(key);
        if (!cat) {
          frag.appendChild(document.createTextNode(m[0]));
          last = m.index + m[0].length;
          continue;
        }
        const mk = document.createElement('mark');
        mk.className = 'itt-hl itt-cat-' + cat;
        mk.dataset.w = key;
        mk.textContent = m[0];
        frag.appendChild(mk);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      if (tn.parentNode) tn.parentNode.replaceChild(frag, tn);
    }
  }

  /* ================= 词卡（Shadow DOM） ================= */
  function ensureCard() {
    if (S.host) return;
    const host = document.createElement('div');
    host.id = 'itt-card-host';
    host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483647;';
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `
      <style>
        *{box-sizing:border-box}
        .card{
          position:fixed;width:330px;max-height:70vh;overflow:auto;
          background:#fff;color:#111827;border-radius:12px;
          box-shadow:0 10px 34px rgba(15,23,42,.22),0 2px 6px rgba(15,23,42,.14);
          border:1px solid rgba(15,23,42,.08);
          font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif;
          padding:12px 14px 10px;
        }
        .row{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
        .w{font-size:19px;font-weight:650;letter-spacing:-.01em}
        .ph{color:#6b7280;font-size:12.5px}
        .close{margin-left:auto;cursor:pointer;color:#9ca3af;font-size:17px;line-height:1;padding:2px 4px;border-radius:6px}
        .close:hover{background:#f3f4f6;color:#374151}
        .mean{margin-top:7px;font-size:14.5px;color:#111827}
        .ex{margin-top:8px;color:#374151;font-size:13px}
        .exzh{margin-top:2px;color:#6b7280;font-size:12.5px}
        .src{margin-top:8px;color:#9ca3af;font-size:11.5px;word-break:break-all}
        .foot{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
        button{
          font:inherit;font-size:12.5px;padding:4px 10px;border-radius:8px;cursor:pointer;
          border:1px solid rgba(15,23,42,.12);background:#f9fafb;color:#111827
        }
        button:hover{background:#f3f4f6}
        button.primary{background:#2563eb;border-color:#2563eb;color:#fff}
        button.primary:hover{background:#1d4ed8}
        .loading{color:#6b7280;font-size:13px;display:flex;align-items:center;gap:8px}
        .loading b{color:#111827;font-size:15px;font-weight:650}
        .spin{width:12px;height:12px;border-radius:50%;border:2px solid #cbd5e1;border-top-color:#2563eb;animation:sp .7s linear infinite;flex:none}
        @keyframes sp{to{transform:rotate(360deg)}}
        .secs{margin-left:auto;font-variant-numeric:tabular-nums;color:#9ca3af;font-size:12px}
        .exload{margin-top:8px;color:#9ca3af;font-size:12.5px;display:flex;align-items:center;gap:6px}
        .exload .spin{width:9px;height:9px;border-width:1.5px}
        @media (prefers-color-scheme: dark){.loading b{color:#f9fafb}}
        .deep{margin-top:9px;padding-top:9px;border-top:1px dashed rgba(15,23,42,.12);white-space:pre-wrap;color:#1f2937;font-size:13px;display:none}
        .srcline{margin-top:8px;padding-top:8px;border-top:1px dashed rgba(15,23,42,.12);color:#6b7280;font-size:12.5px}
        @media (prefers-color-scheme: dark){
          .card{background:#1f2937;color:#e5e7eb;border-color:rgba(255,255,255,.08)}
          .w{color:#f9fafb}
          .mean{color:#e5e7eb}.ex{color:#cbd5e1}.exzh{color:#94a3b8}
          button{background:#374151;border-color:rgba(255,255,255,.1);color:#e5e7eb}
          button:hover{background:#4b5563}
          button.primary{background:#2563eb;color:#fff}
          .deep{color:#e5e7eb;border-color:rgba(255,255,255,.12)}
        }
      </style>
      <div class="card" hidden></div>`;
    document.documentElement.appendChild(host);
    S.host = host;
    S.shadow = sh;
    S.card = sh.querySelector('.card');
    S.card.addEventListener('click', onCardClick);
    S.card.addEventListener('mousedown', (e) => e.stopPropagation());
    S.card.addEventListener('mouseup', (e) => e.stopPropagation());
    // 鼠标在卡片上就别收，好让人点「收藏」等按钮
    S.card.addEventListener('mouseenter', () => { S.overCard = true; clearHideTimer(); });
    S.card.addEventListener('mouseleave', () => { S.overCard = false; if (S.hoverActive) scheduleHoverHide(300); });
  }

  let cardData = null;

  function placeCard(x, y) {
    const c = S.card;
    c.hidden = false;
    const w = 330, h = c.offsetHeight || 160;
    let left = Math.max(8, Math.min(x, window.innerWidth - w - 10));
    let top = y + 10;
    if (top + h > window.innerHeight - 8) top = Math.max(8, y - h - 10);
    c.style.left = left + 'px';
    c.style.top = top + 'px';
    S.cardOpen = true;
  }

  function hideCard() {
    if (S.card) S.card.hidden = true;
    S.overCard = false;
    S.lookupSeq++;                 // 卡片收了，还在路上的查词结果作废，别再弹出来
    clearInterval(loadTick);
    S.cardOpen = false;
    cardData = null;
  }

  /* 加载态：立刻告诉用户「在查哪个词、已经等了多久」，不然分不清是没触发还是在等模型 */
  let loadTick = null;
  function showLoading(x, y, label) {
    ensureCard();
    clearInterval(loadTick);
    const t0 = performance.now();
    S.card.innerHTML = `<div class="loading"><span class="spin"></span>${label ? `<b>${esc(label)}</b>` : ''}<span>查询中…</span><span class="secs">0.0s</span></div>`;
    const secs = S.card.querySelector('.secs');
    loadTick = setInterval(() => {
      if (!secs.isConnected) { clearInterval(loadTick); return; }
      secs.textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's';
    }, 100);
    placeCard(x, y);
  }

  function renderWord(d, x, y, saved) {
    ensureCard();
    cardData = { kind: 'word', data: d };
    const isSaved = saved || S.words.has((d.word || '').toLowerCase());
    S.card.innerHTML = `
      <div class="row">
        <span class="w">${esc(d.word || '')}</span>
        <span class="ph">${esc(d.phonetic || '')}</span>
        <span class="close" data-act="close">×</span>
      </div>
      <div class="mean">${esc([d.pos, d.meaning].filter(Boolean).join(' '))}</div>
      <div class="exbox">${exampleHtml(d)}</div>
      ${d.ctx ? `<div class="srcline">原文语境：${esc(d.ctx)}</div>` : ''}
      <div class="deep"></div>
      <div class="foot">
        <button data-act="say">🔊 朗读</button>
        <button data-act="save" class="${isSaved ? '' : 'primary'}" title="已收藏的再点一下取消收藏">${isSaved ? '★ 已收藏' : '☆ 收藏'}</button>
        <button data-act="known">${(S.words.get((d.word || '').toLowerCase()) || {}).state === 'known' ? '✓ 已学' : '标记已学'}</button>
        <button data-act="deep">AI 细讲</button>
      </div>`;
    placeCard(x, y);
  }

  function exampleHtml(d) {
    if (d.example) return `<div class="ex">${esc(d.example)}</div>${d.exampleZh ? `<div class="exzh">${esc(d.exampleZh)}</div>` : ''}`;
    if (d._exPending) return '<div class="exload"><span class="spin"></span>例句生成中…</div>';
    return '';
  }

  function renderSentence(src, dst, x, y) {
    ensureCard();
    cardData = { kind: 'sentence', src, dst };
    S.card.innerHTML = `
      <div class="row"><span class="w" style="font-size:14px">译文</span><span class="close" data-act="close">×</span></div>
      <div class="mean">${esc(dst)}</div>
      <div class="src">${esc(src)}</div>
      <div class="foot">
        <button data-act="copy">复制译文</button>
        <button data-act="say-src">🔊 读原文</button>
        <button data-act="save-sentence">☆ 收藏这句</button>
      </div>`;
    placeCard(x, y);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  async function onCardClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const act = btn.dataset.act;

    if (act === 'close') { hideCard(); return; }
    if (!cardData) return;

    if (act === 'say' || act === 'say-src') {
      const t = act === 'say-src' ? cardData.src : (cardData.data && cardData.data.word);
      speak(t || '', act === 'say' ? 'en-US' : 'en-US');
      return;
    }
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(cardData.dst || ''); toast('已复制'); } catch (e) { toast('复制失败'); }
      return;
    }
    if (act === 'save-sentence') {
      if (cardData.kind !== 'sentence') return;
      await saveSentence(cardData.src, cardData.dst);
      btn.textContent = '★ 已收藏';
      return;
    }
    if (act === 'known') {
      if (cardData.kind !== 'word') return;
      await toggleKnown(cardData.data.word || '');
      btn.textContent = '✓ 已学';
      return;
    }
    if (act === 'save') {
      if (cardData.kind !== 'word') return;
      // 已收藏的再点一下 = 取消收藏
      const key = String(cardData.data.word || '').toLowerCase();
      if (S.words.has(key)) {
        await unsaveWord(key);
        btn.textContent = '☆ 收藏';
        btn.classList.add('primary');
        const kb = S.card.querySelector('[data-act="known"]');
        if (kb) kb.textContent = '标记已学';
      } else {
        await saveWord(cardData.data);
        btn.textContent = '★ 已收藏';
        btn.classList.remove('primary');
      }
      return;
    }
    if (act === 'deep') {
      const box = S.card.querySelector('.deep');
      if (!box) return;
      box.style.display = 'block';
      box.textContent = '正在生成…';
      const d = cardData.data || {};
      const res = await sendBg({ type: 'explain', text: d.word || '', meaning: d.meaning || '' });
      box.textContent = res && res.ok ? res.text : ('失败：' + ((res && res.error) || '未知错误'));
      return;
    }
  }

  function speak(text, lang) {
    if (!text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang || 'en-US';
      u.rate = 0.95;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) { /* 无语音可用 */ }
  }

  /* ================= 查词 ================= */
  function contextFor(word) {
    try {
      const sel = window.getSelection();
      let node = sel && sel.anchorNode;
      let el = node ? (node.nodeType === 3 ? node.parentElement : node) : null;
      const block = el && el.closest(BLOCK_SEL);
      if (!block) return '';
      const text = textOf(block);
      const i = text.toLowerCase().indexOf(String(word).toLowerCase());
      if (i < 0) return text.slice(0, 120);
      return text.slice(Math.max(0, i - 90), Math.min(text.length, i + word.length + 110)).trim();
    } catch (e) { return ''; }
  }

  /* 优先用指针所在段落取原文语境 */
  function contextAt(word, x, y) {
    try {
      if (x == null || y == null) return contextFor(word);
      const el = document.elementFromPoint(x, y);
      const block = el && el.closest && el.closest(BLOCK_SEL);
      if (block) {
        const text = textOf(block);
        const i = text.toLowerCase().indexOf(String(word).toLowerCase());
        if (i >= 0) return text.slice(Math.max(0, i - 90), Math.min(text.length, i + word.length + 110)).trim();
        if (text) return text.slice(0, 200);
      }
    } catch (e) {}
    return contextFor(word);
  }

  async function showWord(word, x, y, preloaded) {
    if (!word) return;
    const key = String(word).toLowerCase();
    const existing = S.words.get(key);
    if (preloaded) { renderWord(preloaded, x, y, true); return; }
    if (existing && existing.meaning) {
      renderWord(Object.assign({ ctx: contextAt(word, x, y) }, existing), x, y, true);
      return;
    }
    const cached = S.knowCache.get(key);
    if (cached) { renderWord(Object.assign({ ctx: contextAt(word, x, y) }, cached), x, y); return; }

    const seq = ++S.lookupSeq;
    showLoading(x, y, word);
    const exP = sendBg({ type: 'wordExample', text: word });
    const res = await sendBg({ type: 'word', text: word });
    if (seq !== S.lookupSeq) return;               // 期间又查了别的词，这个结果作废
    clearInterval(loadTick);
    if (!res || !res.ok) {
      if (S.card) S.card.innerHTML = `<div class="row"><span class="w" style="font-size:14px">查询失败</span><span class="close" data-act="close">×</span></div><div class="mean" style="font-size:12.5px;color:#b91c1c">${esc((res && res.error) || '未知错误')}</div>`;
      return;
    }
    const data = Object.assign({}, res.data, { ctx: contextAt(word, x, y) });
    if (!data.example) data._exPending = true;
    renderWord(data, x, y);
    if (!data._exPending) { S.knowCache.set(key, res.data); return; }

    const ex = await exP;
    const exData = (ex && ex.ok && ex.data) || {};
    delete data._exPending;
    Object.assign(data, exData);
    const full = Object.assign({}, res.data, exData);
    S.knowCache.set(key, full);
    // 卡片还停在这个词上就把例句补进去
    if (cardData && cardData.data === data && S.card) {
      const box = S.card.querySelector('.exbox');
      if (box) box.innerHTML = exampleHtml(data);
    }
    // 例句回来前就点了收藏的，把例句补进生词本
    const saved = S.words.get(String(full.word || word).toLowerCase());
    if (saved && !saved.example && exData.example) {
      saved.example = exData.example; saved.exampleZh = exData.exampleZh || '';
      const { wordbook } = await chrome.storage.local.get('wordbook');
      const wb = wordbook || {};
      const k = String(full.word || word).toLowerCase();
      if (wb[k]) { wb[k].example = exData.example; wb[k].exampleZh = exData.exampleZh || ''; await chrome.storage.local.set({ wordbook: wb }); }
    }
  }

  async function showSentence(src, x, y) {
    const key = 's:' + src;
    if (S.trCache.has(src)) { renderSentence(src, S.trCache.get(src), x, y); return; }
    const seq = ++S.lookupSeq;
    showLoading(x, y, '');
    const res = await sendBg({ type: 'translate', texts: [src] });
    if (seq !== S.lookupSeq) return;
    clearInterval(loadTick);
    if (res && res.ok && res.results && res.results[src]) {
      S.trCache.set(src, res.results[src]);
      renderSentence(src, res.results[src], x, y);
    } else {
      if (S.card) S.card.innerHTML = `<div class="row"><span class="w" style="font-size:14px">翻译失败</span><span class="close" data-act="close">×</span></div><div class="mean" style="font-size:12.5px;color:#b91c1c">${esc((res && res.error) || '未知错误')}</div>`;
    }
  }

  async function unsaveWord(key) {
    const { wordbook } = await chrome.storage.local.get('wordbook');
    const wb = wordbook || {};
    const word = (wb[key] && wb[key].word) || key;
    delete wb[key];
    await chrome.storage.local.set({ wordbook: wb });
    S.words = new Map(Object.entries(wb));
    toast('已取消收藏 · ' + word);
    if (S.settings && S.settings.highlightWords) highlightWords();
    remarkAllSlots();
  }

  async function saveWord(d) {
    const entry = {
      word: d.word || '',
      phonetic: d.phonetic || '',
      pos: d.pos || '',
      meaning: d.meaning || '',
      example: d.example || '',
      exampleZh: d.exampleZh || '',
      ctx: d.ctx || '',
      url: location.href,
      title: document.title,
      ts: Date.now()
    };
    const key = entry.word.toLowerCase();
    if (!key) return;
    const { wordbook } = await chrome.storage.local.get('wordbook');
    const wb = wordbook || {};
    wb[key] = Object.assign({}, wb[key], entry);
    await chrome.storage.local.set({ wordbook: wb });
    S.words = new Map(Object.entries(wb));
    toast('已收藏 · ' + entry.word);
    if (S.settings && S.settings.highlightWords) highlightWords();
  }

  /* ================= 悬浮球 ================= */
  let ballEl = null;

  function ensureBall() {
    if (ballEl) return;
    if (!S.settings || S.settings.showBall === false) return;

    const host = document.createElement('div');
    host.id = 'itt-ball-host';
    host.style.cssText = 'position:fixed;right:0;top:0;width:0;height:0;z-index:2147483647;';
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `
      <style>
        .wrap{position:fixed;right:12px;display:flex;align-items:center;gap:8px;user-select:none;touch-action:none}
        .ball{
          width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;
          font:600 15px/1 -apple-system,"PingFang SC",sans-serif;cursor:pointer;
          background:linear-gradient(145deg,#3b82f6,#2563eb);color:#fff;
          box-shadow:0 6px 18px rgba(37,99,235,.38),0 1px 2px rgba(0,0,0,.12);
          opacity:.5;transition:opacity .18s ease,transform .18s ease;
          border:2px solid rgba(255,255,255,.7);
        }
        .ball:hover{opacity:1;transform:scale(1.06)}
        .ball.on{background:linear-gradient(145deg,#10b981,#059669);box-shadow:0 6px 18px rgba(5,150,105,.4)}
        .tip{
          background:rgba(17,24,39,.92);color:#fff;font:12px/1.4 -apple-system,"PingFang SC",sans-serif;
          padding:4px 9px;border-radius:7px;white-space:nowrap;opacity:0;transform:translateX(6px);
          transition:.18s;pointer-events:none
        }
        .wrap:hover .tip{opacity:1;transform:translateX(0)}
      </style>
      <div class="wrap">
        <div class="tip">翻译此页</div>
        <div class="ball">译</div>
      </div>`;
    document.documentElement.appendChild(host);

    const wrap = sh.querySelector('.wrap');
    const ball = sh.querySelector('.ball');
    const tip = sh.querySelector('.tip');
    if (!wrap || !ball || !tip) return;

    const saved = Number(S.settings.ballTop);
    wrap.style.top = (Number.isFinite(saved) && saved > 0 ? saved * window.innerHeight : window.innerHeight * 0.42) + 'px';

    let down = null, moved = false, dragging = false;

    ball.addEventListener('pointerdown', (e) => {
      down = { y: e.clientY, top: parseFloat(wrap.style.top) || 200 };
      moved = false; dragging = true;
      try { ball.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    ball.addEventListener('pointermove', (e) => {
      if (!dragging || !down) return;
      const dy = e.clientY - down.y;
      if (Math.abs(dy) > 4) moved = true;
      if (moved) wrap.style.top = Math.max(8, Math.min(window.innerHeight - 50, down.top + dy)) + 'px';
    });
    ball.addEventListener('pointerup', () => {
      dragging = false;
      if (moved) {
        const top = parseFloat(wrap.style.top) || 0;
        const ratio = Math.max(0.02, Math.min(0.95, top / Math.max(1, window.innerHeight)));
        chrome.storage.local.set({ settings: Object.assign({}, S.settings, { ballTop: ratio }) }).catch(() => {});
      } else {
        toggle();
        updateBall();
      }
      down = null;
    });
    ball.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      sendBg({ type: 'openOptions' });
    });

    ballEl = { host, sh, ball, tip, wrap };
    updateBall();
  }

  function updateBall() {
    if (!ballEl) return;
    ballEl.ball.classList.toggle('on', !!S.on);
    ballEl.tip.textContent = S.on ? '关闭翻译（右键=设置）' : '翻译此页（右键=设置）';
  }

  /* ================= 收藏句子 / 标记已学 ================= */
  async function saveSentence(src, dst) {
    const key = 's:' + src.slice(0, 180);
    const { library } = await chrome.storage.local.get('library');
    const lib = library || {};
    lib[key] = { src, dst, url: location.href, title: document.title, ts: Date.now() };
    await chrome.storage.local.set({ library: lib });
    toast('已收藏这句');
  }

  async function toggleKnown(word) {
    const key = String(word || '').toLowerCase();
    if (!key) return;
    const { wordbook } = await chrome.storage.local.get('wordbook');
    const wb = wordbook || {};
    if (!wb[key]) {
      wb[key] = { word: word, meaning: '', ts: Date.now() };
    }
    wb[key].state = wb[key].state === 'known' ? 'new' : 'known';
    await chrome.storage.local.set({ wordbook: wb });
    S.words = new Map(Object.entries(wb));
    toast(wb[key].state === 'known' ? '已标为学会，不再高亮' : '已放回生词');
    highlightWords();
  }

  /* ================= 悬停查词 ================= */
  function wordAtPoint(x, y) {
    let range = null;
    try {
      if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
      else if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y);
        if (p) {
          range = document.createRange();
          range.setStart(p.offsetNode, p.offset);
          range.collapse(true);
        }
      }
    } catch (e) { return null; }
    if (!range) return null;

    let node = range.startContainer, off = range.startOffset;
    if (node.nodeType !== 3) {
      const child = node.childNodes[Math.min(off, node.childNodes.length - 1)];
      if (!child || child.nodeType !== 3) return null;
      node = child; off = 0;
    }
    const data = node.nodeValue || '';
    const isW = (c) => /[A-Za-z'’-]/.test(c || '');
    let s = off, e = off;
    if (!isW(data[off])) { s = off - 1; e = off - 1; }
    if (!isW(data[s])) return null;
    while (s > 0 && isW(data[s - 1])) s--;
    while (e < data.length && isW(data[e])) e++;
    const word = data.slice(s, e).replace(/^[-'’]+|[-'’]+$/g, '');
    if (!/^[A-Za-z][A-Za-z'’-]{1,29}$/.test(word)) return null;
    let rect = { left: x, bottom: y };
    try {
      const r = document.createRange();
      r.setStart(node, s); r.setEnd(node, Math.min(e, data.length));
      const b = r.getBoundingClientRect();
      if (b && b.width) rect = b;
    } catch (e2) {}
    return { word, x: rect.left, y: rect.bottom };
  }

  function cancelHover() {
    if (S.hover.timer) { clearTimeout(S.hover.timer); S.hover.timer = null; }
    S.hover.word = '';
  }

  function clearHideTimer() {
    if (S.hover.hideTimer) { clearTimeout(S.hover.hideTimer); S.hover.hideTimer = null; }
  }

  /* 卡片延迟收起：松开按键或移开单词后留一小会儿，鼠标移进卡片就不收 */
  function scheduleHoverHide(ms) {
    if (S.hover.hideTimer) return;
    S.hover.hideTimer = setTimeout(() => {
      S.hover.hideTimer = null;
      if (S.hoverActive && !S.overCard) { S.hoverActive = false; hideCard(); }
    }, ms);
  }

  /* 悬停查词必须按修饰键：默认 Ctrl（Mac 上 ⌘ 也行），可改 Option(⌥)；不做「裸鼠标悬停」 */
  function hoverGate(e) {
    const mode = S.settings.hoverMode === 'alt' ? 'alt' : (S.settings.hoverMode === 'off' ? 'off' : 'ctrl');
    if (mode === 'off') return null;
    return { mode, held: mode === 'ctrl' ? !!(e.ctrlKey || e.metaKey) : !!e.altKey };
  }

  /* 对指针下的词发起查词。immediate=true 时不等停留（刚按下键） */
  function hoverLookup(info, immediate) {
    clearHideTimer();
    if (info.word === S.hover.word && (S.hover.timer || S.hoverActive)) return;
    cancelHover();
    S.hover.word = info.word;
    S.hover.x = info.x; S.hover.y = info.y;
    S.hover.ax = S.mouse.x; S.hover.ay = S.mouse.y;   // 触发时指针位置，松键后移出 30px 才收
    const fire = () => {
      S.hover.timer = null;
      S.hoverActive = true;
      showWord(info.word, S.hover.x, S.hover.y);
    };
    if (immediate) fire();
    else S.hover.timer = setTimeout(fire, Math.max(60, Number(S.settings.hoverDelay) || 120));
  }

  /* 按下修饰键的那一刻就查指针下的词——以前只在鼠标移动时才触发，按住不动就「没反应」 */
  document.addEventListener('keydown', (e) => {
    if (e.repeat || !S.settings || !S.settings.enableHover) return;
    const mode = S.settings.hoverMode === 'alt' ? 'alt' : (S.settings.hoverMode === 'off' ? 'off' : 'ctrl');
    const hit = mode === 'ctrl' ? (e.key === 'Control' || e.key === 'Meta') : (mode === 'alt' && e.key === 'Alt');
    if (!hit || S.mouse.x < 0 || S.overCard) return;
    const info = wordAtPoint(S.mouse.x, S.mouse.y);
    if (info) hoverLookup(info, true);
  }, true);

  document.addEventListener('mousemove', (e) => {
    S.mouse.x = e.clientX; S.mouse.y = e.clientY;
    if (!S.settings || !S.settings.enableHover) return;
    const gate = hoverGate(e);
    if (!gate) return;
    if (S.overCard) { clearHideTimer(); return; }
    if (!gate.held) {
      if (S.hover.timer) cancelHover();
      if (S.hoverActive) {
        const dx = e.clientX - (S.hover.ax || 0), dy = e.clientY - (S.hover.ay || 0);
        if (dx * dx + dy * dy > 900) scheduleHoverHide(450);
      }
      return;
    }
    if (e.target && e.target.id === 'itt-ball-host') return;
    if (e.buttons === 1) { S.dragging = true; cancelHover(); return; }
    if (S.dragging) { cancelHover(); return; }

    const info = wordAtPoint(e.clientX, e.clientY);
    if (!info) {
      if (S.hoverActive) scheduleHoverHide(380);
      return;
    }
    hoverLookup(info, false);
  }, { passive: true });

  /* 拖选文字时不弹卡 */
  document.addEventListener('mousedown', () => { S.dragging = false; }, true);

  document.addEventListener('keyup', (e) => {
    // 松开键不收卡片（慢的时候结果还在路上）；鼠标移开才收，见 mousemove
    if (e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') {
      if (S.hover.timer) cancelHover();
    }
  });
  window.addEventListener('blur', () => {
    cancelHover();
    if (S.hoverActive) { hideCard(); S.hoverActive = false; }
  });

  /* ================= 划词 ================= */
  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (S.host && e.composedPath && e.composedPath().indexOf(S.host) >= 0) return;
    if (!S.settings || !S.settings.enableSelection) return;
    if (e.ctrlKey || e.metaKey) return;
    const target = e.target;
    if (target && (target.closest && target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]'))) return;

    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const raw = (sel.toString() || '').trim().replace(/\s+/g, ' ');
      if (!raw || raw.length < 2 || raw.length > 800) return;
      let rect;
      try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (err) { return; }
      const x = rect.left, y = rect.bottom;
      S.hoverActive = false;
      if (/^[A-Za-z][A-Za-z'’-]{1,29}$/.test(raw)) showWord(raw, x, y);
      else showSentence(raw, x, y);
    }, 10);
  });

  /* 点生词高亮 → 直接出卡片 */
  document.addEventListener('click', (e) => {
    const mk = e.target && e.target.closest && e.target.closest('mark.itt-hl');
    if (!mk) return;
    e.preventDefault();
    e.stopPropagation();
    const key = (mk.dataset.w || '').toLowerCase();
    const stored = S.words.get(key);
    const r = mk.getBoundingClientRect();
    if (stored) showWord(stored.word || key, r.left, r.bottom, stored);
    else showWord(mk.textContent, r.left, r.bottom);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (S.host && e.composedPath && e.composedPath().indexOf(S.host) >= 0) return;
    if (!S.cardOpen) return;
    if (e.target && e.target.closest && e.target.closest('mark.itt-hl')) return;
    hideCard();
  });

  /* ================= Toast ================= */
  function toast(msg, opts) {
    try {
      const id = 'itt-toast';
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483647;' +
          'background:rgba(17,24,39,.94);color:#fff;font:13px/1.5 -apple-system,"PingFang SC",sans-serif;' +
          'padding:8px 14px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.28);max-width:70vw;display:flex;gap:10px;align-items:center;';
        document.documentElement.appendChild(el);
      }
      el.textContent = '';
      const span = document.createElement('span');
      span.textContent = msg;
      el.appendChild(span);
      if (opts && opts.action) {
        const b = document.createElement('button');
        b.textContent = opts.action;
        b.style.cssText = 'border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font:inherit';
        b.onclick = () => { try { opts.onAction && opts.onAction(); } catch (e) {} el.remove(); };
        el.appendChild(b);
      }
      clearTimeout(el._t);
      el._t = setTimeout(() => el.remove(), opts && opts.action ? 8000 : 2600);
    } catch (e) {}
  }

  /* ================= 消息 ================= */
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === 'toggle') { respond({ on: toggle() }); return true; }
    if (msg.type === 'cycleMode') { respond({ mode: cycleMode() }); return true; }
    if (msg.type === 'setMode') {
      S.mode = msg.mode === 'target' ? 'target' : 'bilingual';
      applyModeClass();
      if (S.settings) {
        chrome.storage.local.set({ settings: Object.assign({}, S.settings, { displayMode: S.mode }) }).catch(() => {});
      }
      respond({ mode: S.mode });
      return true;
    }
    if (msg.type === 'status') {
      respond({
        on: S.on, mode: S.mode, words: S.words.size,
        hasKey: !!(S.settings && (S.settings.provider === 'openai' ? S.settings.dsKey : S.settings.apiKey)),
        count: translatedCount(),
        hasBall: !!ballEl
      });
      return true;
    }
    if (msg.type === 'diag') {
      let cands = 0;
      try { cands = document.querySelectorAll(blockSelector()).length; } catch (e) {}
      respond({
        host: location.hostname,
        adapter: SITE_ADAPTERS.some(a => a.host.test(location.hostname)),
        candidates: cands,
        translated: translatedCount(),
        on: S.on,
        queue: S.queue.length,
        hasKey: !!(S.settings && (S.settings.provider === 'openai' ? S.settings.dsKey : S.settings.apiKey))
      });
      return true;
    }
    if (msg.type === 'rescan') { if (S.on) collect(); respond({ ok: true }); return true; }
    return false;
  });

  /* ================= 启动 ================= */
  (async () => {
    await loadState();
    if (S.settings.showBall !== false) ensureBall();
    if (S.settings.autoTranslate) enable();

    // SPA / 无限滚动
    const mo = new MutationObserver(() => {
      if (location.href !== S.lastHref) {
        S.lastHref = location.href;
        if (S.on) setTimeout(() => collect(), 400);
      }
    });
    try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}

    setInterval(() => {
      if (!S.on) return;
      if (document.visibilityState !== 'visible') return;
      if (S.blocks.size > 1500) return;
      collect();
    }, 2500);
  })();
})();
