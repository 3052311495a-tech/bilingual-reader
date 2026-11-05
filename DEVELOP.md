# 给接手的开发者

这是一个 Chrome MV3 扩展，纯原生 JS，**没有构建步骤**：改完文件在 `chrome://extensions` 点 ⟳ 就生效。

## 怎么跑起来

1. `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选这个目录
2. 点扩展图标 →「设置」→ 填任意一家的 API Key
3. `chrome://extensions` 里改完代码点 ⟳（**注意：改 manifest 必须重载；popup 的 html/js 是每次打开都从磁盘读的**）

## 目录结构

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | MV3 声明；图标在 `icons/`（Codex 生成，`icon-1024.png` 是源图）；权限 `storage / unlimitedStorage / activeTab / scripting`；三条快捷键 |
| `background.js` | Service Worker：统一 LLM 出口（Gemini 原生格式 + OpenAI 兼容格式）、翻译缓存、词典、AI 大纲、测速 |
| `content.js` | 内容脚本：段落抽取与翻译、悬停查词、划词、生词高亮、词卡、悬浮球、收藏句子 |
| `outline.js` | 独立内容脚本：智能大纲面板（结构 / AI 两种），与 content.js 通过 `onMessage` 区分消息类型互不干扰 |
| `content.css` | 译文块、高亮（三类别 × 三形态）、占位符样式 |
| `options.html/js/css` | 设置、生词本、收藏句子、NotebookLM 导出 |
| `popup.html/js` | 工具栏面板 + 诊断区 |
| `local-config.example.js` | 本机预置配置模板。复制成 `local-config.js` 再填 key；`local-config.js` 在 `.gitignore` 里，不进仓库 |

## 关键设计

### 1. 翻译调用统一收口

`background.js` 的 `llm(prompt, {json, temperature, thinking})`：

- `provider: 'gemini'` → `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`（base URL 可配置，支持中转站）
- `provider: 'openai'` → `{base}/chat/completions`（DeepSeek 走这条路，任何 OpenAI 兼容中转站也能用）

`thinking` 只对 `deepseek.com` 域名发送（`{"thinking":{"type":"disabled"}}`），避免严格中转站因未知字段 400。
**翻译/查词关思考，AI 细讲开思考** —— 这是延迟的关键，别改回去。Gemini 2.5 flash 默认也会思考，`geminiCall` 里用 `thinkingConfig.thinkingBudget: 0` 关掉（2.0 系列不认这个字段，只对 2.5 发）。

### 2. 逐段翻译（v0.3 起，参考沉浸式翻译）

一段原文 → 紧跟一段译文 → 下一段原文。核心在 `content.js`「整页翻译」一节：

- **块（block）**：`BLOCK_SEL` 抓到的 `<p>/<li>…`，或站点适配器里的正文容器（X 的推文、X 长文）
- **段落切分** `paragraphs()`：把块拆成 token（文字 / 软换行 / 块级边界），空行、`<br><br>`、块级子元素都算段落边界；单个换行留在段内
- **翻译单元** `groupParas()`：总长 < 280 字的短推文整条一个单元、译文放最后；长文逐段，过短（< 60 字）的相邻段会合并，但中文段不和英文段合并
- **占位** `prepareBlock()`：块进入视口时先把每段的译文元素（隐藏的 `.itt-slot`）插好，再按单元排队；译文回来就填进去
  - 段内插入可能要切开文本节点，`_ittJoin` 记着切口，`cleanupBlock()` 时拼回去（React 还拿着前半截的引用，别用 `normalize()`）
  - 纯 `\n` 分段时插在第一个换行后面（`.itt-tight`），让译文紧贴原文、空行留给下一段
  - 段后是块级边界（X 长文的段落 div、标题）时，插进**包住这段的最内层块**的末尾：译文在段落自己的盒子里，间距跟原文一致
  - 块级与否看 `getComputedStyle().display`，不看标签名：X 会把链接包在 `display:inline` 的 div 里，按标签算会把一句话从链接处切断
  - 进了行内级容器（`inline-flex` / `inline-block`…）之后，里面的元素一律不算段落边界：X 的 @提及 包在 `inline-flex` 里，弹性容器会把子元素强制算成 block，不这样处理会把一句话从 @ 处切断
- **请求**：一次最多 6 个单元 / 2400 字，最多 3 个并发；队列按出现顺序，自上而下
- 后台 prompt 每条用 `<t id="N">…</t>` 包裹，返回 JSON 数组（Gemini）或 `{"items":[...]}`（OpenAI 兼容）。解析失败会退化成逐条单发，**速度掉几倍**，`extractJson()` 已做容错

### 2.0 译文字体

译文元素插入时由 `copyTypography()` 抄**那一段自己**的样式（不是整个块的：X 长文的字号写在每段的 span 上，外层容器是另一个字号），写进 `--itt-*` CSS 变量：字号看段落第一个文字所在元素，字重、颜色、字体看它所在的段落块。标题的译文因此也是标题字号。
原字体链里会去掉 `serif` 这类通用族，再接上中文无衬线链（苹方 → 雅黑 → Noto/思源）：
否则中文在通用族那一步就会匹配到宋体。X 的字体写在推文元素自己身上，插在外面的译文继承不到，这就是以前「宋体 + 一大一小」的原因。

### 2.1 哪些不翻

| 情况 | 在哪判断 |
| --- | --- |
| 已经是目标语言（中文：汉字数 × 4 ≥ 拉丁字母数，且没有假名） | `isTargetLang()`，整块和单段都判断 |
| 导航、菜单、tab、页眉页脚、`aria-hidden` | `CHROME_SEL`；`header/footer/aside` 只在 `main/article` 之外才排除 |
| 站点专属区域（X 右侧栏、热搜、私信抽屉） | 适配器的 `skip` |
| 读屏专用隐藏文字（X 左上角「To view keyboard shortcuts…」，1×1 + clip） | `isVisuallyHidden()`，在 IntersectionObserver 回调里判断 |
| 短的纯链接列表项（菜单、标签云） | `isGoodBlock()` 末尾 |

### 3. 站点适配器（X / Twitter）

```js
const SITE_ADAPTERS = [
  { host: /(^|\.)(x|twitter)\.com$/i,
    sel:  '[data-testid="tweetText"], [data-testid="twitterArticleRichTextView"], [data-testid="UserDescription"]',
    skip: '[data-testid="sidebarColumn"], [data-testid="trend"], [role="tablist"], [data-testid="DMDrawer"]' }
];
```

加新站点就照这个格式加一条。`only: true` 表示这个站点只翻 `sel` 里的正文容器，页面上别的 `h1/h2/li` 都当界面文字（X 顶栏的「Post」就是 h2）。`sel` 里的容器整块交给分段逻辑，容器里面的 `<p>/<li>` 不再单独翻（`insideSiteBlock()`）。

### 3.1 纯译文模式

- 译文插在元素后面的块：直接 `display:none` 原文元素
- 译文插在元素里面的块（长文逐段、`li/td`，带 `data-itt-inner`）：原文字号压成 0，译文用插入时记下的 `--itt-fs` 恢复字号
- 本来就是中文的段落存成 `.itt-same`，只在纯译文模式下显示

### 4. 内容脚本 → 后台的消息

| type | 方向 | 说明 |
| --- | --- | --- |
| `translate` | content → bg | `{texts: []}` → `{results: {原文: 译文}}` |
| `word` | content → bg | 单词 → `{word, phonetic, pos, meaning}`（只要释义，输出短、回得快，卡片先显示它） |
| `align` | content → bg | `{src, dst, words}` → `{map: {词: 译文里对应片段}}`。生词本释义在译文里匹配不上时才调用，按译文哈希缓存 |
| `wordExample` | content → bg | 单词 → `{example, exampleZh}`，和 `word` 并行发，回来后补进卡片 |
| `explain` | content → bg | 词根/搭配/近义/自测题（开思考模式） |
| `outline` | outline.js → bg | `{headings, excerpt}` → `[{level,title}]` |
| `bench` | popup → bg | 两家各打一次小请求，返回毫秒数 |
| `toggle` / `setMode` / `status` / `diag` | popup → content | 开关、模式、状态、诊断 |

## 已知坑（改的时候注意）

1. **改 manifest 必须重载**，否则 `scripting` 权限和新内容脚本都不生效，表现为「翻译此页没反应」。
2. **内容脚本不会注入到安装前已打开的标签页**，所以 popup 里做了 `chrome.scripting.executeScript` 按需补注入。
3. **X 是 React**，重渲染会删掉插入的译文节点或改掉原文；`collect()` 每 2.5s 用 `needsRedo()`（占位是否还在 + 原文长度签名）检测，清掉后重翻（命中缓存，瞬间完成），别删这段。
4. **blocks 用 `innerText`**，隐藏元素取到空串会被跳过 —— 折叠区域展开后靠 2.5s 轮询补上。
5. 生词高亮走 `TreeWalker` + lookbehind 正则，每页最多 800 个文本节点、1200 个 block，超长页面靠后部分不高亮。
6. `local-config.js` 是明文配置文件，已 gitignore；**打包发人时也别带上它**。缺这个文件时 `background.js` 的 `importScripts` 会静默跳过。

## 可以接着做

- 生词本间隔重复（今天到期 N 个）
- PDF / EPUB 阅读器模式
- 按段落并发自适应：先测一次延迟，再决定 4 段还是 2 段
