<p align="center">
  <img src="icons/icon128.png" width="96" alt="icon">
</p>

<h1 align="center">我的双语阅读 · Bilingual Reader</h1>

<p align="center">
  自己掌控的「沉浸式翻译」Chrome 扩展：逐段双语对照、按住 Ctrl 悬停查词、生词高亮，<br>
  生词和收藏的句子一键导出成 NotebookLM 学习包。
</p>

---

- **逐段对照**：一段英文原文，紧跟一段中文译文，再下一段——长文、X（Twitter）长推、X Articles 都按段落插入
- **只翻该翻的**：本来就是中文的段落、导航栏、侧栏、菜单、读屏隐藏文字一律跳过
- **用你自己的 API Key**：支持 Gemini 官方接口和任何 OpenAI 兼容接口（DeepSeek、中转站、自建服务），请求从你的浏览器直达服务商，没有中间服务器
- **学英语的配套**：悬停查词、划词翻译、生词本、三色高亮、收藏句子、导出到 NotebookLM / Anki
- **纯原生 JS，无构建步骤**：下载就能装，改了代码点一下刷新就生效

## 安装

还没上架 Chrome 应用商店，用「加载已解压的扩展程序」安装，大约 1 分钟：

1. 下载代码：
   ```bash
   git clone https://github.com/3052311495a-tech/bilingual-reader.git
   ```
   不用 git 的话，点本页绿色的 **Code → Download ZIP**，解压。
2. Chrome 地址栏打开 `chrome://extensions`
3. 右上角打开 **开发者模式**
4. 点 **加载已解压的扩展程序**，选 `bilingual-reader` 文件夹
5. 工具栏里出现蓝色书本图标，点它 → **设置**，填 API Key（见下一节）
6. 点 **测试连接**，看到「连上了」就可以用了

> Edge、Arc、Brave 等 Chromium 内核浏览器同样可用。
> 如果同时装了沉浸式翻译、扇贝等翻译扩展，建议先关掉，划词浮层会互相打架。

## 配置翻译服务

设置页第一项「翻译服务」二选一，两个都填也行，随时切换：

| 你手上的 Key | 「翻译服务」选 | 怎么填 |
| --- | --- | --- |
| [Google AI Studio](https://aistudio.google.com/apikey) 的 Gemini Key（有免费额度） | Gemini 官方接口 | 填 Key，地址留默认，模型选 `gemini-2.5-flash` |
| [DeepSeek](https://platform.deepseek.com/) 官方 Key | OpenAI 兼容 | Base `https://api.deepseek.com`，模型 `deepseek-flash` |
| 中转站，OpenAI 格式（`/v1/chat/completions`） | OpenAI 兼容 | Base 填中转站地址（通常带 `/v1`），模型名按它的文档填 |
| 中转站，Gemini 原生格式（`…/v1beta`） | Gemini 官方接口 | 接口地址改成中转站的，Key 填中转站的 |
| OpenAI、自建 vLLM / Ollama 等 | OpenAI 兼容 | Base 和模型名按服务商填 |

设置页的 **测速对比** 会同时给两家各发一个小请求，告诉你哪家更快。

**翻译成**：默认简体中文，也可以选繁体中文、日语、韩语、英语。已经是目标语言的段落不会再翻。

> API Key 只保存在你这台电脑的 `chrome.storage.local` 里，不会上传到任何地方。

## 怎么用

### 翻译网页

| 操作 | 效果 |
| --- | --- |
| 点页面右侧的蓝色「译」悬浮球，或按 `⌥ + T`（Windows：`Alt + T`） | 开 / 关整页翻译 |
| `⌥ + Y` | 切换「双语对照」和「纯译文」（隐藏原文，只看中文） |
| 右键悬浮球 | 打开设置 |
| 上下拖动悬浮球 | 换个位置，会记住 |

默认打开网页就自动翻译（设置里可关）。只翻看得见的部分，滚到哪翻到哪；同一段只翻一次，有缓存，刷新页面不重复花钱。

### 查词和划词

| 操作 | 效果 |
| --- | --- |
| 鼠标指着单词，**按下 `Ctrl`**（Mac 上 `⌘` 也行） | 立刻弹出卡片：先显示「查询中」和计时，释义一回来就显示，例句随后补上；按住 Ctrl 移到别的词会接着查 |
| 松开 Ctrl | 卡片留着，可以移进去点按钮；鼠标移开就收（设置里可把按键改成 ⌥ Option） |
| 用鼠标划选一个词 | 词典卡：音标、释义、例句 |
| 划选一句或一段 | 直接出译文 |
| 卡片里 **🔊 朗读** | 系统语音朗读 |
| 卡片里 **☆ 收藏** | 加入生词本，同时记下你读到它的那句原文 |
| 卡片里 **AI 细讲** | 词根、搭配、近义词辨析、一道自测题 |
| 卡片里 **标记已学** | 不再高亮这个词 |
| 点页面里高亮的生词 | 再次打开它的卡片 |

收藏过的词会在所有网页上高亮：**青绿 = 今天收的，琥珀 = 生词，绿色 = 已学**。高亮样式（下划线 / 线+底色 / 纯底色）和要标哪几类，都在设置里调。

### 智能大纲

按 `⌥ + O` 打开当前页面的大纲面板：「结构」读页面的标题层级，「AI 大纲」让模型读正文后重新整理。

### 快捷键改键

上面的快捷键都能在 `chrome://extensions/shortcuts` 里改。

## 导出到 NotebookLM / Anki

设置页 → **导出 / NotebookLM**：

- **下载 Markdown 学习包**：在 NotebookLM 里 Add source → Upload，选这个 `.md` 文件。文件开头已写好学习指令，直接问它就行，例如：
  - 「用这些词出 10 道中译英填空，先只出题，我答完再判错因」
  - 「根据每个词的原文语境，指出我可能误解的地方」
  - 「生成 7 天复习表」
- **复制到剪贴板**：Add source → Copied text 粘贴
- **CSV**：Anki、欧路词典可直接导入

学习包里每个词都带「原文语境」和出处链接，NotebookLM 能据此判断你当时是不是理解偏了。

> NotebookLM 没有公开的写入 API，所以这里不做「自动同步」，走官方支持的上传方式，稳定不会坏。

## 隐私

- 没有账号、没有统计、没有任何第三方服务器
- 翻译的文本只发给你在设置里选的那家服务商
- API Key、生词本、收藏、翻译缓存都只存在本机浏览器的扩展存储里

## 已知限制

- 免费 Gemini Key 有频率限制，长文连续翻译可能遇到 429（会提示）；可以换 `gemini-2.0-flash-lite` 或换服务商
- 段落识别靠 `p / li / td` 等语义标签和站点适配，纯 `div` 堆出来的网站可能漏译；X（Twitter）已单独适配
- 只翻译主页面，不进 iframe
- 生词本只存在本机，不跨设备同步
- 生词高亮每页最多处理 800 个文本节点，超长页面靠后的部分可能不高亮

## 本地预置配置（可选）

不想每次重装都在设置页填 Key 的话：把 `local-config.example.js` 复制一份改名为 `local-config.js`，在里面填好服务商和 Key。这个文件已加入 `.gitignore`，不会被提交。

## 参与开发

纯原生 JS 的 Chrome MV3 扩展，没有依赖、没有构建步骤。改完代码在 `chrome://extensions` 点扩展卡片上的 ⟳ 就生效（改了 `manifest.json` 必须点）。

代码结构、逐段翻译的实现方式、各种坑，见 [DEVELOP.md](DEVELOP.md)。欢迎提 Issue 和 PR，尤其是新站点的适配（在 `content.js` 顶部的 `SITE_ADAPTERS` 里加一条即可）。

```
bilingual-reader/
  manifest.json            扩展声明（MV3）
  background.js            API 调用（Gemini / OpenAI 兼容）、翻译缓存、词典、AI 细讲、测速
  content.js               逐段翻译、悬停查词、划词、高亮、词卡、悬浮球
  outline.js               智能大纲面板
  content.css              译文与高亮样式
  options.html/js/css      设置、生词本、导出
  popup.html/js            工具栏弹窗
  local-config.example.js  本地预置配置模板
  icons/                   图标
```

## 许可证

[MIT](LICENSE)
