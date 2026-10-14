import { randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
const projectDirectory = fileURLToPath(new URL('../', import.meta.url));

export function parsePublicHost(input) {
  const candidate = input.trim();
  let url;
  try { url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`); }
  catch { throw new Error('请输入公网 IPv4 或完整域名，例如 8.8.8.8 或 dream.example.com。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('地址只能包含公网 IPv4 或域名，不要添加端口、路径或账号信息。');
  }
  const hostname = url.hostname.toLowerCase();
  if (isIP(hostname) === 4) {
    const [a, b, c] = hostname.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)))) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) {
      throw new Error('请使用阿里云服务器的公网 IPv4，不能使用内网、保留或示例 IP。');
    }
  } else if (isIP(hostname) !== 0 || hostname.includes(':') || hostname.length > 253 ||
      !hostname.includes('.') || /\.(?:localhost|local|internal|invalid|test|arpa)$/.test(hostname) ||
      !hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error('请输入有效的公网域名或公网 IPv4；此配置工具不接受 IPv6。');
  }
  return hostname;
}

export async function buildAliyunEnvironment(host, username, password) {
  const hostname = parsePublicHost(host);
  if (!/^[a-zA-Z0-9_.@-]{3,80}$/.test(username)) throw new Error('用户名需为 3–80 个字母、数字或 _ . @ - 字符。');
  if (password.length < 14 || password.length > 256 || /[\u0000-\u001f\u007f]/.test(password)) {
    throw new Error('密码需为 14–256 个字符，且不能包含控制字符。');
  }
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return {
    APP_DOMAIN: hostname,
    APP_ORIGIN: `https://${hostname}`,
    OWNER_USERNAME: username,
    OWNER_PASSWORD_HASH: `scrypt$${salt}$${derived.toString('hex')}`,
    SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ARCHIVE_MODE: 'aliyun',
    HOST: '0.0.0.0',
    PORT: '3000',
    DATA_DIR: '/app/data',
  };
}

export function serializeComposeEnvironment(environment) {
  // Compose treats single-quoted .env values literally. In particular, the $
  // separators in a scrypt hash must not become variable interpolation.
  return '# Private deployment configuration. Never commit or share this file.\n' +
    Object.entries(environment).map(([name, value]) => {
      if (!/^[A-Z][A-Z0-9_]*$/.test(name) || typeof value !== 'string' || /['\\\r\n\u0000]/.test(value)) {
        throw new Error('配置中包含不支持的字符。');
      }
      return `${name}='${value}'`;
    }).join('\n') + '\n';
}

function readHiddenPassword(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const wasRaw = Boolean(input.isRaw);
    let value = '';
    const finish = (error) => {
      input.off('data', receive);
      input.off('error', failed);
      input.setRawMode(wasRaw);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const failed = () => finish(new Error('无法读取隐藏密码输入。'));
    const receive = (chunk) => {
      // Ignore terminal escape sequences rather than adding arrow-key bytes.
      if (chunk.includes('\u001b')) return;
      for (const character of chunk) {
        if (character === '\u0003' || character === '\u0004') return finish(new Error('配置已取消，未保存密码。'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = [...value].slice(0, -1).join('');
        else if (character >= ' ' && value.length < 257) value += character;
      }
    };
    process.stdout.write(prompt);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.on('data', receive);
    input.once('error', failed);
    input.resume();
  });
}

export async function main() {
  if (process.argv.slice(2).some((argument) => ['--help', '-h'].includes(argument))) {
    console.log('用法：node scripts/setup-aliyun.mjs\n在交互式终端中输入公网 IPv4／域名、用户名和隐藏密码。仅创建 deploy/aliyun/.env，不覆盖已有配置，不调用任何云 API。');
    return;
  }
  if (process.argv.length > 2) throw new Error('本工具不接受命令行凭据，请直接运行并按提示输入。');
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('请在交互式终端运行；为防止密码回显，不支持通过管道或重定向输入密码。Docker 请添加 -it。');
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let host, username;
  try {
    host = parsePublicHost(await readline.question('阿里云公网 IPv4 或域名（不带端口）：'));
    username = (await readline.question('网站用户名 [oneiros]：')).trim() || 'oneiros';
  } finally { readline.close(); }
  const password = await readHiddenPassword('网站密码（14–256 个字符，输入不回显）：');
  const confirmation = await readHiddenPassword('再次输入网站密码：');
  if (password !== confirmation) throw new Error('两次密码不一致，未创建配置文件。');
  const environment = await buildAliyunEnvironment(host, username, password);
  const destination = path.join(projectDirectory, 'deploy', 'aliyun', '.env');
  await mkdir(path.dirname(destination), { recursive: true });
  try { await writeFile(destination, serializeComposeEnvironment(environment), { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('deploy/aliyun/.env 已存在；为保留原加密密钥，本工具拒绝覆盖。请先妥善备份并手动管理已有配置。');
    throw new Error('无法创建配置文件，请检查 deploy/aliyun 目录的写入权限。');
  }
  console.log('已创建 deploy/aliyun/.env。密码摘要与加密密钥未输出到终端。请妥善备份此文件，再按 docs/deploy-aliyun.md 启动。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
