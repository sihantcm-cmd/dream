# Vercel + Supabase 个人版部署

此方案与[阿里云服务器版](deploy-aliyun.md)使用同一 UI 和 AI 功能，但基础设施不同：Vercel 运行前端和 API，Supabase 提供邮箱登录、Postgres 档案和私有媒体存储。只上传 GitHub 代码还不够，需要先完成以下项目配置。

这里的步骤是部署说明，不表示你的 Supabase 资源、邮件服务或线上环境已经开通。不要将本机 `.env`、梦境数据或 AI 密钥推送到 GitHub。

## 建立 Supabase 项目

1. 创建或选择自己控制的 Supabase 项目，在 SQL Editor 执行仓库的 `supabase/001_personal_cloud.sql`。
2. 确认已创建 `cloud_accounts`、`cloud_dreams`、`ai_settings` 表，以及非公开的 `oneiros-media` bucket。
3. 启用邮箱身份验证，在 Authentication → Users 中建立自己的用户。该邮箱必须与后面的 `OWNER_EMAIL` 完全对应；本应用没有公共注册入口。
4. 在 **Magic Link** 和 **Confirm signup** 邮箱模板中显示 `{{ .Token }}` 验证码，例如 `<p>Oneiros 登录验证码：{{ .Token }}</p>`。页面采用输入 6–10 位验证码的方式；默认仅带登录链接的邮件模板需要修改。[邮件模板文档](https://supabase.com/docs/guides/auth/auth-email-templates)
5. 配置可用的发信渠道。Supabase 默认邮件服务仅给项目团队成员的邮箱发信，且当前限制较低（官方说明为每小时 2 封），不保证送达；正式使用应配置自有 SMTP。[SMTP 文档](https://supabase.com/docs/guides/auth/auth-smtp)

当前数据库迁移采用“仅服务端可读写”的策略：启用 RLS，并撤销浏览器角色对应用表的权限。服务器验证 Supabase 会话和唯一的 `OWNER_EMAIL`，再通过服务端凭据访问该账号的数据。浏览器只获得特定媒体对象的短时上传／下载地址，不能列出整个 bucket。不要为了修复权限报错把 bucket 改为公开或把表改为任意用户可读写。

## 设置 Vercel 环境变量

在项目 Settings → Environment Variables 为 Production 配置下列值。Preview 如需独立测试，建议使用独立 Supabase 项目与密钥，避免写入正式档案。

| 变量 | 内容 | 可出现在前端？ |
| --- | --- | --- |
| `ARCHIVE_MODE` | `supabase` | 不需要 |
| `SUPABASE_URL` | 项目的 HTTPS URL | 可以 |
| `SUPABASE_PUBLISHABLE_KEY` | 项目的 publishable key；旧项目可改用 `SUPABASE_ANON_KEY` | 可以 |
| `SUPABASE_SERVICE_ROLE_KEY` | 项目的服务端 service-role key | **不可以** |
| `OWNER_EMAIL` | 唯一允许登录此档案的邮箱 | 不需要 |
| `SETTINGS_ENCRYPTION_KEY` | 随机 32 字节的 Base64 字符串，用于加密 API 设置 | **不可以** |
| `APP_ORIGIN` | 正式网站源，例如 `https://dream-one-liart.vercel.app`，不带末尾 `/` | 可以 |

加密密钥可以在可信本机生成一次，然后直接填写到 Vercel 的环境变量输入框并妥善备份：

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
```

不要给 service-role key、加密密钥或模型 API key 添加 `VITE_` 前缀；这类前缀会将值暴露到前端构建。更改环境变量后重新部署。不要随意替换加密密钥，否则原有设置无法解密。

AI 密钥无需放进 Vercel 构建环境。网站登录后在 API 设置页填写 DeepSeek 与百炼密钥，服务端加密保存。

## 部署与登录

Vercel 项目连接 `sihantcm-cmd/dream`，框架使用 Vite，构建命令为 `npm run build`，输出目录为 `dist`。仓库的 `vercel.json` 将 `/api/*` 交给 `api/index.ts`，函数最大执行时间设为 300 秒。不要用只上传 `dist` 的方式代替包含 API 入口的完整部署。

把正式域名加入 Supabase Authentication 的 Site URL 与允许的 Redirect URLs。部署完成后：

1. 打开网站，应显示个人登录界面。
2. 输入 `OWNER_EMAIL` 并获取验证码，使用邮件中的验证码登录。
3. 在 API 设置保存密钥、模型与北京地域 workspace ID。
4. 运行两家连接测试，然后分别验收转写、解读、绘图、对话。百炼连接测试只验证 ASR，绘图需要实际生成一次才能验证对应模型权限。
5. 保存测试梦境，刷新、退出、重新登录，确认媒体与对话持久保存。未登录访问档案和设置接口必须被拒绝。

缺少云端必要配置时，页面应显示配置提示，不会退回没有登录保护的本机模式。`/api/session` 是公开的登录配置入口；梦境、密钥设置和 AI 接口均需要登录。

## 文件与执行时长

Vercel 函数请求和响应最多 4.5 MB；Hobby 的 Fluid Compute 执行上限为 300 秒。录音和备份媒体使用浏览器直传 Supabase，生成图片由服务端写入私有存储后返回访问地址，避免把大文件穿过函数响应。云端 AI 请求采用更短超时，超时后保留草稿，由你决定是否重试。[Vercel 函数限制](https://vercel.com/docs/functions/limitations)

档案保存在 Postgres，图片和录音保存在私有 bucket；函数 `/tmp` 不作为档案存储。当前云端每条梦境及对话上限约 1 MB，最多 500 条，超限需先导出并整理。不要把数据库中的媒体路径替换成会过期的签名 URL。

## 备份与常见问题

- 通过应用“导出备份”得到包含媒体的可迁移档案。另行备份 Supabase 数据库、Storage 对象和 `SETTINGS_ENCRYPTION_KEY`；只有数据库备份不足以恢复原始媒体文件。
- 登录邮件收不到：核对邮箱是否属于项目团队，或自有 SMTP 是否配置并通过验证；不要不断点击发送触发限流。
- API 为 404：确认该次部署包含 `api/index.ts` 和 `vercel.json`，而不是只有静态目录。
- 存储错误：确认 SQL 已执行、服务端凭据属于同一个项目，且 `oneiros-media` 存在。
- 设置无法解密：先恢复原加密密钥。若原密钥确实丢失，需要管理员备份后清除该账号无法解密的 API 设置，再重新填写模型密钥；网页不能直接覆盖旧密文恢复。
- AI 超时：保留草稿后手动重试；不要依赖自动重试付费模型请求。

Vercel、Supabase、邮件和模型服务可能有套餐或用量费用，请以各自控制台为准。本仓库的部署文件不会自动购买或升级任何服务。
