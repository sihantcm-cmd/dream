# 阿里云个人版部署

这个版本把网站、登录会话、API 设置、梦境档案和媒体放在你自己的阿里云 Linux 服务器。一个 Node.js 进程处理应用，Caddy 提供 HTTPS，Docker 命名卷保存数据。适合一个人使用；不要运行多个应用副本共享同一档案卷。

AI 仍通过设置页配置的 DeepSeek / 阿里云百炼调用。服务器不需要安装 AI 模型，也不要求 GPU。部署不会自动上传你电脑上的 `.env` 或梦境档案。

## 准备服务器与访问地址

优先使用已有 Linux 服务器。新建时，轻量应用服务器的 Docker 应用镜像是简便选项；普通 ECS 安装 Docker Engine 和 Compose 插件也可以。建议至少 2 GB 内存，给依赖安装和前端构建留出空间；这是一项运行建议，不是套餐承诺。服务器、流量、域名和模型调用费用以购买页及服务商账单为准，本仓库不会自动购买资源。[阿里云产品说明](https://www.alibabacloud.com/help/en/simple-application-server/product-overview/what-is-simple-application-server)

中国内地服务器对外提供网站前需要完成 ICP 备案；香港或海外地域无需办理该项备案。尚未备案而需要尽快上线时，可选择香港地域，再根据实际访问体验决定后续迁移。[阿里云备案说明](https://help.aliyun.com/en/icp-filing/basic-icp-service/user-guide/icp-filing-application-overview)

1. 没有域名时，直接使用服务器分配的公网 IPv4。已有域名时，例如 `dream.example.com`，将 A 记录指向该 IPv4；只有确实配置了 IPv6 才添加 AAAA 记录。
2. 在阿里云防火墙／安全组开放 TCP 80、443；可选开放 UDP 443 以使用 HTTP/3。SSH 22 限制为自己的来源 IP。不要开放应用端口 3000。
3. 确认 `docker version` 和 `docker compose version` 可用。如果是已有服务器，安装 Docker 即可；不要为了切换镜像而重置有数据的系统盘。[阿里云 Docker 部署说明](https://www.alibabacloud.com/help/en/simple-application-server/use-cases/deploy-and-use-docker)

Caddy 需要外部可达的 80／443 端口和持久证书目录；采用域名时，还需要正确的 DNS 解析。有效 HTTPS 是浏览器录音和安全登录 Cookie 的前提。[Caddy HTTPS 文档](https://caddyserver.com/docs/automatic-https)

本配置显式使用 Let's Encrypt 的 `shortlived` 证书配置档，支持公网 IPv4 和域名。IP 证书自 2026 年 1 月起正式开放，约 160 小时有效，Caddy 负责自动续期。因此可以先使用 `https://服务器公网IPv4`，不必先购买域名。不要关闭证书卷或长期阻断验证端口。真实证书的申请和浏览器信任仍需在服务器部署后验收；仅验证配置文件不等于已经获得证书。[Let's Encrypt 官方公告](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)、[Caddy 证书配置](https://caddyserver.com/docs/caddyfile/directives/tls)

## 生成个人登录配置

在服务器克隆代码，在项目根目录执行配置工具：

```sh
git clone https://github.com/sihantcm-cmd/dream.git
cd dream
npm run setup:aliyun
```

此命令需要 Node.js。若服务器只安装了 Docker，可以改用官方 Node 镜像运行同一个工具，不必先在主机安装 Node：

```sh
docker run --rm -it --user "$(id -u):$(id -g)" \
  --mount type=bind,src="$PWD",dst=/workspace \
  --workdir /workspace node:24.21.0-bookworm-slim \
  node scripts/setup-aliyun.mjs
```

工具询问公网 IPv4／域名、应用用户名和密码，以隐藏输入接收密码，生成 `deploy/aliyun/.env`。密码至少 14 个字符。已有配置文件时拒绝覆盖，避免误换加密密钥。这是网站自己的登录账号，与阿里云账号、RAM 用户及 SSH 密码无关。

| 变量 | 含义 |
| --- | --- |
| `APP_DOMAIN` | 公网 IPv4 或域名，不带 `https://` 或路径，用于 Caddy |
| `APP_ORIGIN` | 完整 HTTPS 源，例如 `https://dream.example.com` 或 `https://服务器公网IPv4` |
| `OWNER_USERNAME` | 网站个人账号 |
| `OWNER_PASSWORD_HASH` | 工具生成的 scrypt 密码摘要，不能填明文密码 |
| `SETTINGS_ENCRYPTION_KEY` | 工具生成的 32 字节 Base64 加密密钥，需与数据备份一起妥善保留 |
| `ARCHIVE_MODE` | Compose 固定为 `aliyun` |
| `DATA_DIR` | Compose 固定为容器内 `/app/data` |
| `HOST` / `PORT` | 容器内部使用 `0.0.0.0:3000`，不向主机发布此端口 |

不要把 `.env` 提交到 GitHub，也不要把 API 密钥写进 Dockerfile 或构建参数。Git 和 Docker 构建上下文均排除 `.env*`。API 密钥在登录后的设置页填写，加密保存在档案卷。

## 启动

```sh
cd deploy/aliyun
chmod 600 .env
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
```

打开配置的 HTTPS 地址，确认浏览器证书没有警告，再使用刚创建的账号登录。进入 API 设置，保存 DeepSeek、百炼密钥及百炼北京地域业务空间 ID，再进行连接测试。DeepSeek 连接测试读取模型列表；百炼连接测试提交 1 秒合成静音，可能消耗少量 ASR 额度，且不代表绘图权限已经验证。

在应用内依次完成：录音转写、梦境解读、生成图片、发送对话；保存后刷新页面，确认文字、图片、录音和对话仍可读取。最后退出登录，确认档案和 API 设置已无法访问。一次正式功能验收可能产生模型调用费用。

查看运行日志时，使用：

```sh
docker compose --env-file .env logs --tail=100 app caddy
```

不要发布完整环境文件、`docker inspect` 输出或不带 `--quiet` 的 Compose 配置输出，这些内容可能包含凭据。

## 持久存储与备份

`oneiros_archive` 保存档案、媒体、加密 API 配置和会话状态。`oneiros_caddy_data` 保存证书，`oneiros_caddy_config` 保存 Caddy 状态。重建容器不会删除命名卷；`docker compose down -v` 会删除数据，不能用于日常更新。[Docker 卷文档](https://docs.docker.com/engine/storage/volumes/)

应用以 UID/GID 1000 的非 root 用户运行。镜像预先建立该用户拥有的 `/app/data`，新命名卷沿用该目录属性；启动时不递归修改宿主机目录权限。如果自己改成 bind mount，需要在指定空数据目录设置 UID/GID 1000 的写权限，不要对任意父目录执行递归 `chown`。

小规模迁移可用应用内“导出备份”。完整服务器备份还要保留加密设置与登录配置。下面把备份放到仓库和网站目录之外，短暂停止应用以取得一致快照：

```sh
sudo install -d -m 700 /var/backups/oneiros
docker compose --env-file .env stop app
docker run --rm --user 0 \
  --mount type=volume,src=oneiros_archive,dst=/data,readonly \
  --mount type=bind,src=/var/backups/oneiros,dst=/backup \
  node:24.21.0-bookworm-slim \
  sh -c 'umask 077; tar -czf "/backup/archive-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C /data .'
sudo install -m 600 .env /var/backups/oneiros/aliyun.env
docker compose --env-file .env start app
```

确认归档命令成功后，再将备份保存到自己控制的另一处位置。备份包含个人梦境与安全配置，不会由应用自动上传。不要丢失 `SETTINGS_ENCRYPTION_KEY`，否则旧 API 设置无法解密，需要重新填写密钥。恢复时先停止应用，在专用卷中恢复，并保留文件原 UID/GID 1000。

## 更新

先完成备份，再回到仓库根目录拉取代码，重新构建和启动。保留现有 `.env` 和卷；更新代码时无需重新生成加密密钥。

```sh
git pull --ff-only
docker compose --env-file deploy/aliyun/.env -f deploy/aliyun/compose.yaml up -d --build
```

当前镜像固定为官方 `node:24.21.0-bookworm-slim` 和 `caddy:2.11.7-alpine`，版本已在 2026-10-14 核对；后续安全更新需要显式更新镜像版本并重新构建。[Node 官方镜像列表](https://github.com/docker-library/official-images/blob/master/library/node)、[Caddy 官方镜像列表](https://github.com/docker-library/official-images/blob/master/library/caddy)

中国内地网络可能无法稳定拉取 Docker Hub 镜像或 npm 依赖。先确认服务器可访问官方镜像源和 npm registry；如需镜像加速，按阿里云控制台提供的官方容器镜像服务说明配置，不要改用来源不明的公共代理。香港地域通常便于访问这些外部依赖，但仍以实际构建结果为准。
