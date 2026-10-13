# Oneiros · 梦境志

保留原有 React / Vite 画廊界面，使用 Express 提供个人本机后端。梦境、解读、对话存入本机 JSON 档案，图片与录音单独落盘；刷新和重启后仍可读取。

**V2.0.0** 已接通本机存储及四项真实 AI 功能，更新内容见 [CHANGELOG.md](CHANGELOG.md)。GitHub Release 提供的是源码压缩包，不是安装程序；请按下方步骤安装依赖并启动。发布文件不含 API 密钥或个人档案，首次使用需自行配置 `.env`。

## 本机启动

需要 Node.js **22.12 或以上**。Windows 可以双击 `启动梦境志.cmd`，或在项目目录运行：

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run build
npm start
```

打开 **http://127.0.0.1:3000**。首次打开会导入两条示例梦境；删空档案后不会再次灌入。开发时使用 `npm run dev`，同样运行完整后端，不需要单独启动 Vite。`npm run preview` 也使用完整生产服务器。

没有 AI 密钥时，点击记录梦境中的 **Save without AI / 直接保存**，即可保存文字、醒后感受和录音；可以在详情里修改标题、感受和删除记录。草稿可稍后生成解读与画作，失败时可重试。文本草稿临时保留在当前浏览器标签页；要长期保存录音，请点击保存。

## 启用真实 AI

默认使用 DeepSeek 解读与对话、阿里云百炼转写与绘图。编辑本机 `.env`，填入两家的密钥，然后重启服务：

```dotenv
AI_TEXT_PROVIDER=deepseek
AI_MEDIA_PROVIDER=dashscope
DEEPSEEK_API_KEY=你的DeepSeek密钥
DASHSCOPE_API_KEY=你的百炼北京地域密钥
```

在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 登录并创建 API Key；在 [百炼 API Key 页面](https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key) 登录，选择 **华北2（北京）**、默认业务空间并创建密钥。如设置自定义模型权限，允许 `qwen-audio-3.1-asr-flash` 和 `qwen-image-3.0-pro`。账号开通、实名认证、协议与余额按控制台要求完成；不需要购买云服务器。两项百炼功能使用同一把密钥。见 [百炼官方密钥说明](https://help.aliyun.com/zh/model-studio/get-api-key)。

密钥只由服务器读取，不进入浏览器构建或 Git，也不用发到聊天中。解读和对话文本发送给 DeepSeek；转写录音和绘画提示词发送给百炼。仅填 DeepSeek 密钥即可使用文字解读与对话；仅填百炼密钥即可转写、为已有解读补图。页面显示每项功能的配置状态；该状态不代表密钥已经通过真实调用验证。

默认模型见 `.env.example`，可通过环境变量替换：

| 功能 | 默认模型 | 接口 |
| --- | --- | --- |
| 解读与对话 | `deepseek-v4-pro` | Chat Completions，MAX 深度思考；解读采用 JSON 模式 |
| 绘图 | `qwen-image-3.0-pro` | 千问图像 3.0 旗舰版，2K、思考模式、Agent 提示词增强，图片存入本机 |
| 录音转写 | `qwen-audio-3.1-asr-flash` | 百炼原生同步语音转写接口，Base64 WAV |

实现参考 [DeepSeek Chat API](https://api-docs.deepseek.com/api/create-chat-completion/)、[Qwen Audio 3.1 ASR](https://help.aliyun.com/zh/model-studio/qwen-audio-3-1-asr-flash)、[千问图像生成 API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)。以上为质量优先默认值：更深的思考和更大的图像可能增加费用与等待时间，并不意味着所有输入都能得到更好结果。`DEEPSEEK_REASONING_EFFORT` 支持 `max`（默认）、`high`、`low`、`none`；思考模式预留 65,536 个输出 token 上限，只保存最终答复。文字和绘图请求最多等待 10 分钟，浏览器预留 11 分钟。超时不自动重试付费请求。

`DEEPSEEK_MODEL`、`DASHSCOPE_ASR_MODEL`、`DASHSCOPE_IMAGE_MODEL` 可覆盖默认模型，必须兼容所选接口。仍兼容原先的 `qwen3-asr-flash` 与 `qwen-image-2.0` 配置。`DASHSCOPE_WORKSPACE_ID` 可填北京地域业务空间 ID；留空使用仍受支持的共享域名。更换模型后，如现有密钥设置了模型白名单，需要在控制台调整对应权限。

浏览器录音保留原文件，转写前在本机转换为 16 kHz 单声道 PCM WAV；百炼转写限本应用设定的 **3 分钟、Base64 编码后 10 MB**。本机存档的原录音仍限 20 MB。需要 localhost 或 HTTPS 和麦克风权限。解读/对话按输入语言回复。千问 3.0 画作采用 2K 尺寸：1:1 为 2048×2048，4:3 为 2304×1728，16:9 为 2688×1512。页面按当前模型显示实际请求尺寸；旧模型保留原尺寸。

保留 Gemini 作为可选配置：将 `AI_TEXT_PROVIDER` 或 `AI_MEDIA_PROVIDER` 改为 `gemini`，并填入 `GEMINI_API_KEY`。Gemini 模型配置仍见 `.env.example`。每次修改 `.env` 后都需重启。

## 数据与备份

- 默认 `DATA_DIR=./data`：`dreams.json` 存档案，`media/` 存图片及音频。整个目录已排除 Git。
- 页面上方 **Export backup / 导出备份** 生成包含本机媒体的便携 JSON。**Import / 导入** 合并备份，已有同 ID 的记录保持原样，不覆盖。
- JSON 导出限 48 MB、导入限 49 MB / 500 条。更大的档案应在停止服务后复制整个 `data` 文件夹，恢复时同样先停止服务。外部 HTTP 图片链接保留链接，不主动下载。
- 从旧浏览器版迁移时先合并，再把原始记录保留为浏览器 `localStorage` 中的 `oneiros_dreams_v1_backup`。旧版 `blob:` 录音已不能恢复，文字与解读会保留。
- 删除梦境只删除档案条目；媒体文件暂时保留，以免误删共享引用。备份应按需妥善保管。
- 原子文件替换与进程内写入队列保护档案；检测到损坏文件时拒绝覆盖。**同一 DATA_DIR 只能运行一个服务进程**。

默认只监听 `127.0.0.1:3000`。这是个人单用户档案，没有账号或多用户隔离；当前完成范围是本机使用。`PORT` 可修改端口，不要把当前版本直接暴露为公开服务。

## API

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/api/health` | 存储状态、AI 是否配置（不验证密钥有效性） |
| GET / POST | `/api/dreams` | 列表 / 保存 |
| GET / PUT / DELETE | `/api/dreams/:id` | 查询 / 修改 / 删除 |
| PATCH | `/api/dreams/:id/chat` | 保存对话 |
| POST | `/api/dreams/bootstrap` | 首次导入示例 |
| POST | `/api/dreams/import` | 合并导入 |
| GET | `/api/archive/export` | 含本机媒体的备份 |
| POST | `/api/transcribe` | 录音转写 |
| POST | `/api/interpret` | 结构化解读 |
| POST | `/api/generate-image` | 生成并保存画作 |
| POST | `/api/chat-symbol` | 多轮象征对话 |

## 验证

```powershell
npm run check
```

执行 TypeScript 检查、生产构建和自动化测试。测试使用独立临时数据目录，验证真实 HTTP/API 与磁盘读写；AI 契约测试用受控上游响应验证 SDK 对接，不发送真实云端请求、不消耗配额。因此测试通过不等于已经验证你的真实密钥或模型权限。

如果端口被占用，关闭先前的梦境志进程或修改 `.env` 的 `PORT`。如果无法使用 AI，页面会区分缺少密钥、密钥无效、配额不足、模型权限和网络失败；原文可以继续直接保存。不要把 `.env`、密钥或完整请求日志提交到 Git。

## 真实 AI 联调

配置密钥并重启服务后，先自行准备一份合成语音的 PCM WAV 文件（建议 16 kHz 单声道，不超过 3 分钟），再运行四项真实接口验收。仓库不附带本机验收音频；将下面的路径替换为你的测试文件：

```powershell
npm run verify:ai -- --audio "./your-synthetic-test.wav"
```

这条命令会实际调用转写、解读、当前服务支持的绘图尺寸和对话，可能消耗服务商配额；不包含在日常 `npm test` 中。报告和成功阶段结果缓存在 `data/ai-verification/`，再次运行会复用相同配置下已完成的阶段，最后保存一条明确标记的合成语音验收梦境并回读检查。脚本只访问本机 API，不读取或打印密钥；上游失败不会自动重新提交付费生成。
