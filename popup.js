/* popup：状态 + 按需注入（解决"装完没刷新页面"） */
const $ = (s) => document.querySelector(s);
let lastErr = '';

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function send(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res || null);
    });
  });
}

/* 页面在扩展安装/重载之前就打开了 → 手动补注入 */
async function inject(tab) {
  if (!chrome.scripting) { lastErr = '浏览器不支持按需注入'; return false; }
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js', 'outline.js'] });
    return true;
  } catch (e) {
    lastErr = (e && e.message) || String(e);
    return false;
  }
}

async function getStatus(tab, allowInject) {
  let st = await send(tab.id, { type: 'status' });
  if (st || !allowInject) return st;
  const ok = await inject(tab);
  if (!ok) return null;
  await new Promise((r) => setTimeout(r, 80));
  return await send(tab.id, { type: 'status' });
}

async function refresh() {
  const tab = await activeTab();
  if (!tab || !tab.id) return;

  const first = await send(tab.id, { type: 'status' });
  const st = first || (await getStatus(tab, true));
  const injectedNow = !first && !!st;

  if (!st) {
    $('#count').textContent = '—';
    $('#keyRow').style.display = 'flex';
    $('#keyMsg').textContent = lastErr
      ? ('这页不能注入：' + lastErr.slice(0, 54))
      : '这个页面不允许扩展运行（chrome:// 或扩展商店）';
    $('#toggle').disabled = true;
    $('#toggle').textContent = '此页不可用';
    $('#dot').classList.add('off');
    return;
  }

  $('#toggle').disabled = false;
  $('#count').textContent = st.count || 0;
  $('#words').textContent = st.words || 0;
  $('#dot').classList.toggle('off', !st.on);
  $('#toggle').textContent = st.on ? '关闭本页翻译' : '翻译此页';
  $('#toggle').classList.toggle('on', !!st.on);

  if (!st.hasKey) {
    $('#keyRow').style.display = 'flex';
    $('#keyMsg').textContent = '还没填 API Key';
  } else {
    $('#keyRow').style.display = 'none';
  }

  if (injectedNow) {
    const n = $('#note');
    n.style.display = 'block';
    n.textContent = '已就本页补注入脚本（原来没加载），右侧会出现小球';
  }
}

$('#toggle').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab || !tab.id) return;
  let res = await send(tab.id, { type: 'toggle' });
  if (!res) {
    await inject(tab);
    await new Promise((r) => setTimeout(r, 80));
    res = await send(tab.id, { type: 'toggle' });
  }
  setTimeout(refresh, 260);
  void res;
});

async function setMode(mode) {
  const tab = await activeTab();
  if (tab && tab.id) {
    let res = await send(tab.id, { type: 'setMode', mode });
    if (!res) {
      await inject(tab);
      await new Promise((r) => setTimeout(r, 80));
      await send(tab.id, { type: 'setMode', mode });
    }
  }
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: Object.assign({}, settings || {}, { displayMode: mode }) });
  setTimeout(refresh, 220);
}

$('#modeBi').addEventListener('click', () => setMode('bilingual'));
$('#modeTarget').addEventListener('click', () => setMode('target'));

$('#outline').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab || !tab.id) return;
  let res = await send(tab.id, { type: 'toggleOutline' });
  if (!res) {
    await inject(tab);
    await new Promise((r) => setTimeout(r, 90));
    await send(tab.id, { type: 'toggleOutline' });
  }
  window.close();
});

$('#goSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#openWords').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + '#words' });
});

async function renderDiag() {
  const tab = await activeTab();
  const box = $('#diagBody');
  if (!tab || !tab.id) { box.textContent = 'no tab'; return; }
  const d = await send(tab.id, { type: 'diag' });
  const { lastError } = await chrome.storage.local.get('lastError');
  const lines = [];
  if (!d) {
    lines.push('<span class="bad">内容脚本未运行</span> → 这个页面没加载扩展');
  } else {
    lines.push(`站点 <b>${d.host}</b> ${d.adapter ? '<span class="good">适配器生效</span>' : '<span class="bad">通用模式</span>'}`);
    lines.push(`可翻段落 <b>${d.candidates}</b> · 已翻 <b>${d.translated}</b> · 队列 <b>${d.queue}</b>`);
    lines.push(`开关 <b>${d.on ? '开' : '关'}</b> · Key ${d.hasKey ? '<span class="good">已填</span>' : '<span class="bad">未填</span>'}`);
  }
  if (lastError && Date.now() - lastError.ts < 3600000) {
    lines.push(`<span class="bad">错 ${lastError.code || ''} ${String(lastError.msg).slice(0, 48)}</span>`);
  }
  box.innerHTML = lines.join('<br>');
}

$('#diagBtn').addEventListener('click', renderDiag);
$('#ver').textContent = 'v' + chrome.runtime.getManifest().version;
refresh().then(renderDiag);
