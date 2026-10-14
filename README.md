# Oneiros · 梦境志

保留原有 React / Vite 梦境画廊界面，提供梦境记录、语音转写、AI 解读、绘图和象征对话。新增两个个人云端部署方案：阿里云服务器版，以及 Vercel + Supabase 版；原来的本机版继续保留。

**V2.1.0 正在准备发布**，更新内容见 [CHANGELOG.md](CHANGELOG.md)。这次改动包含云端登录、API 密钥设置、私有持久存储和部署文件；云资源尚未完成开通，两个云端环境的实际登录、证书、存储及四项 AI 验收仍待部署后完成。V2.0 的本机真实 AI 验收不能替代云端验收。

GitHub Release 提供源码，不是安装程序。发布内容不含 API 密钥或个人档案；两种云端部署都需要自己的基础设施配置，并在登录后的 API 设置页填入模型密钥。

## 选择部署方式

| 方式 | 登录 | 持久存储 | 部署说明 |
| --- | --- | --- | --- |
| 阿里云个人版 | 自建用户名／密码，安全 HttpOnly Cookie | 自己的服务器，Docker 命名卷存档案、媒体和加密设置 | [阿里云部署](docs/deploy-aliyun.md) |
| Vercel + Supabase 个人版 | 仅允许指定邮箱，邮件验证码 | Supabase Postgres + 私有 Storage bucket | [Vercel 部署](docs/deploy-vercel.md) |
| 本机版 | 无账号，限本机使用 | 本机 `data/` 目录 | [本机启动](#本机启动) |

优先上线阿里云个人版时，可使用香港 Linux 服务器、公网 IPv4 和 Caddy 自动 HTTPS，无需先购买域名。首次配置命令为 `npm run setup:aliyun`，会隐藏输入密码、生成加密密钥并保存到忽略提交的 `deploy/aliyun/.env`；Docker 启动、证书申请、备份和更新步骤见对应部署文档。阿里云登录账号是应用账号，与阿里云控制台或 RAM 凭据无关。

已有 Vercel 站点时，按第二份文档建立 Supabase 项目、执行 SQL、配置指定邮箱及 Vercel 环境变量，再部署完整仓库。只上传 `dist` 不能启动后端。两种云端模式都在缺少安全配置时拒绝开放档案，不会自动退回无登录的本机模式。

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

三种方式默认使用相同模型：DeepSeek 解读与对话、阿里云百炼转写与绘图。

**云端个人版**：登录后打开 API 设置，填写两家密钥、模型及百炼北京地域业务空间 ID，然后保存。密钥在服务端加密持久保存；重新打开设置只显示配置状态，不回显已有密钥。可替换或删除密钥、选择思考强度并测试连接，无需重新构建网站。DeepSeek 测试读取模型列表；百炼测试提交 1 秒合成静音，可能消耗 ASR 额度，成功不代表绘图权限已经验证。四项功能仍需分别实际使用验收。

**本机版**：编辑 `.env`，填入两家的密钥，然后重启服务：

```dotenv
AI_TEXT_PROVIDER=deepseek
AI_MEDIA_PROVIDER=dashscope
DEEPSEEK_API_KEY=你的DeepSeek密钥
DASHSCOPE_API_KEY=你的百炼北京地域密钥
```

在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 登录并创建 API Key；在 [百炼 API Key 页面](https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key) 登录，选择 **华北2（北京）**、默认业务空间并创建密钥。如设置自定义模型权限，允许 `qwen-audio-3.1-asr-flash` 和 `qwen-image-3.0-pro`。账号开通、实名认证、协议与余额按控制台要求完成。调用百炼本身不需要购买云服务器；只有选择阿里云托管方案时才需要服务器。两项百炼功能使用同一把密钥。见 [百炼官方密钥说明](https://help.aliyun.com/zh/model-studio/get-api-key)。

密钥只由服务器读取，不进入浏览器构建或 Git，也不用发到聊天中。解读和对话文本发送给 DeepSeek；转写录音和绘画提示词发送给百炼。仅填 DeepSeek 密钥即可使用文字解读与对话；仅填百炼密钥即可转写、为已有解读补图。页面显示每项功能的配置状态；该状态不代表密钥已经通过真实调用验证。

本机默认模型见 `.env.example`，云端默认模型及配置项见 API 设置页：

| 功能 | 默认模型 | 接口 |
| --- | --- | --- |
| 解读与对话 | `deepseek-v4-pro` | Chat Completions，MAX 深度思考；解读采用 JSON 模式 |
| 绘图 | `qwen-image-3.0-pro` | 千问图像 3.0 旗舰版，2K、思考模式、Agent 提示词增强，图片写入所选私有存储 |
| 录音转写 | `qwen-audio-3.1-asr-flash` | 百炼原生同步语音转写接口，Base64 WAV |

实现参考 [DeepSeek Chat API](https://api-docs.deepseek.com/api/create-chat-completion/)、[Qwen Audio 3.1 ASR](https://help.aliyun.com/zh/model-studio/qwen-audio-3-1-asr-flash)、[千问图像生成 API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)。以上为质量优先默认值：更深的思考和更大的图像可能增加费用与等待时间，并不意味着所有输入都能得到更好结果。思考强度支持 `max`（默认）、`high`、`low`、`none`；思考模式预留 65,536 个输出 token 上限，只保存最终答复。

| 运行方式 | 高质量文字／绘图单次上游等待上限 |
| --- | --- |
| 本机、阿里云服务器 | 10 分钟 |
| Vercel + Supabase | 4 分钟 |

模型、MAX 思考和 2K 绘图默认质量相同，区别是托管环境的执行时间。Vercel 为函数的 300 秒上限预留了下载和保存时间；较慢生成可能先超时。超时会保留草稿，不自动重新提交付费请求。[Vercel 函数限制](https://vercel.com/docs/functions/limitations)

本机环境变量 `DEEPSEEK_MODEL`、`DASHSCOPE_ASR_MODEL`、`DASHSCOPE_IMAGE_MODEL` 可覆盖默认模型；云端在设置页修改。模型必须兼容所选接口，仍兼容原先的 `qwen3-asr-flash` 与 `qwen-image-2.0`。`DASHSCOPE_WORKSPACE_ID` 可填北京地域业务空间 ID；留空使用仍受支持的共享域名。更换模型后，如现有密钥设置了模型白名单，需要在控制台调整对应权限。

浏览器录音保留原文件，转写前在本机转换为 16 kHz 单声道 PCM WAV；百炼转写限本应用设定的 **3 分钟、Base64 编码后 10 MB**。本机存档的原录音仍限 20 MB。需要 localhost 或 HTTPS 和麦克风权限。解读/对话按输入语言回复。千问 3.0 画作采用 2K 尺寸：1:1 为 2048×2048，4:3 为 2304×1728，16:9 为 2688×1512。页面按当前模型显示实际请求尺寸；旧模型保留原尺寸。

本机版保留 Gemini 作为可选配置：将 `AI_TEXT_PROVIDER` 或 `AI_MEDIA_PROVIDER` 改为 `gemini`，并填入 `GEMINI_API_KEY`。Gemini 模型配置仍见 `.env.example`。本机每次修改 `.env` 后都需重启；当前云端设置页使用 DeepSeek + 百炼。

## 数据与备份

云端部署按自己的账号隔离档案，不自动上传本机旧档案或浏览器历史；需要迁移时，先在来源版本导出包含媒体的 JSON，再登录目标版本显式导入。

- 阿里云：`oneiros_archive` 命名卷保存档案、媒体、加密 API 设置和登录会话。完整备份还需要保留 `deploy/aliyun/.env`，特别是加密密钥；详见[服务器备份步骤](docs/deploy-aliyun.md#持久存储与备份)。
- Vercel：Postgres 保存档案和加密设置，私有 bucket 保存媒体；函数临时文件系统不保存档案。应用通过身份验证和私有媒体地址读写。
- 两种云端：最多 500 条梦境，单条梦境和对话约 1 MB。页面导出在浏览器下载媒体后组合备份，媒体总量限 36 MB、最终 JSON 限 49 MB；大档案请分别备份实际存储。导入使用独立媒体上传和分批记录请求。

本机版数据规则保持如下：

- 默认 `DATA_DIR=./data`：`dreams.json` 存档案，`media/` 存图片及音频。整个目录已排除 Git。
- 页面上方 **Export backup / 导出备份** 生成包含本机媒体的便携 JSON。**Import / 导入** 合并备份，已有同 ID 的记录保持原样，不覆盖。
- JSON 导出限 48 MB、导入限 49 MB / 500 条。更大的档案应在停止服务后复制整个 `data` 文件夹，恢复时同样先停止服务。外部 HTTP 图片链接保留链接，不主动下载。
- 从旧浏览器版迁移时先合并，再把原始记录保留为浏览器 `localStorage` 中的 `oneiros_dreams_v1_backup`。旧版 `blob:` 录音已不能恢复，文字与解读会保留。
- 删除梦境只删除档案条目；媒体文件暂时保留，以免误删共享引用。备份应按需妥善保管。
- 原子文件替换与进程内写入队列保护档案；检测到损坏文件时拒绝覆盖。**同一 DATA_DIR 只能运行一个服务进程**。

本机模式默认监听 `127.0.0.1:3000`，没有账号，只用于本机。公开部署必须选择带登录保护的 `ARCHIVE_MODE=aliyun` 或 `supabase`，不能直接把本机模式改成公网监听。两个云端方案均面向一名档案所有者，不提供公共注册、多用户管理或共享图库。

## API

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/api/session` | 公开的部署／登录状态，不返回私有档案或密钥 |
| POST | `/api/auth/login` | 云端登录：阿里云密码验证，Supabase 发送邮箱验证码 |
| POST | `/api/auth/logout` | 阿里云注销会话；Supabase 由 Auth SDK 注销 |
| GET / PUT | `/api/settings` | 云端读取设置状态／加密保存模型密钥和配置 |
| POST | `/api/settings/test` | 云端验证已保存的服务商连接 |
| POST | `/api/media/upload` | 云端获取限定文件的上传凭证 |
| GET | `/api/health` | 存储状态、AI 是否配置（不验证密钥有效性） |
| GET / POST | `/api/dreams` | 列表 / 保存 |
| GET / PUT / DELETE | `/api/dreams/:id` | 查询 / 修改 / 删除 |
| PATCH | `/api/dreams/:id/chat` | 保存对话 |
| POST | `/api/dreams/bootstrap` | 首次导入示例 |
| POST | `/api/dreams/import` | 合并导入 |
| GET | `/api/archive/export` | 本机版含媒体备份；云端请通过页面导出 |
| POST | `/api/transcribe` | 录音转写 |
| POST | `/api/interpret` | 结构化解读 |
| POST | `/api/generate-image` | 生成并保存画作 |
| POST | `/api/chat-symbol` | 多轮象征对话 |

云端档案、媒体、设置和 AI 接口必须通过身份验证。Supabase 请求使用 Bearer token；阿里云使用安全 Cookie。设置响应不含已保存的 API 密钥。

## 验证

```powershell
npm run check
```

执行 TypeScript 检查、生产构建和自动化测试。测试使用独立临时数据目录和受控上游响应，不调用真实付费模型；包含凭据隔离、配置加密和认证边界等检查。测试通过不能证明云账号已开通、HTTPS 证书已签发、SMTP 可发信或真实模型权限有效；这些需要按部署文档在各自环境验收。

如果端口被占用，关闭先前的梦境志进程或修改 `.env` 的 `PORT`。如果无法使用 AI，页面会区分缺少密钥、密钥无效、配额不足、模型权限和网络失败；原文可以继续直接保存。不要把 `.env`、密钥或完整请求日志提交到 Git。

## 真实 AI 联调

以下脚本用于**本机版**，不绕过云端登录。配置本机密钥并重启后，先自行准备一份合成语音的 PCM WAV 文件（建议 16 kHz 单声道，不超过 3 分钟），再运行四项真实接口验收。仓库不附带本机验收音频；将下面的路径替换为你的测试文件：

```powershell
npm run verify:ai -- --audio "./your-synthetic-test.wav"
```

这条命令会实际调用转写、解读、当前服务支持的绘图尺寸和对话，可能消耗服务商配额；不包含在日常 `npm test` 中。报告和成功阶段结果缓存在 `data/ai-verification/`，再次运行会复用相同配置下已完成的阶段，最后保存一条明确标记的合成语音验收梦境并回读检查。脚本只访问本机 API，不读取或打印密钥；上游失败不会自动重新提交付费生成。

云端真实验收在登录后的页面操作：保存设置、测试连接、上传合成语音、完成解读／绘图／对话、刷新回读、退出后检查访问被拒绝。阿里云和 Vercel 各需要独立验收，不能互相代替。
