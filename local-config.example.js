/* 本地预置配置模板（可选）
   用法：复制本文件为 local-config.js，填好下面的内容，然后到 chrome://extensions 点「重新加载」。
   local-config.js 已在 .gitignore 里，不会被提交；不建这个文件也完全没问题，在设置页填 Key 即可。 */
self.__ITT_LOCAL__ = {
  settings: {
    provider: 'openai',                 // 'gemini' 或 'openai'（DeepSeek / 中转站 / 其他 OpenAI 兼容接口）
    dsBase: 'https://api.deepseek.com',
    dsModel: 'deepseek-flash',
    dsKey: ''                           // 你的 API Key
    // Gemini 用这几项：
    // apiKey: '',
    // geminiBase: 'https://generativelanguage.googleapis.com/v1beta',
    // model: 'gemini-2.5-flash'
  }
};
