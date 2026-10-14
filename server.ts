import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(appRoot, '.env') });
const { createApp } = await import('./server/app');
const mode = process.env.ARCHIVE_MODE || 'local';
if (!['local', 'cloud', 'aliyun', 'supabase'].includes(mode)) throw new Error('ARCHIVE_MODE must be local, aliyun or supabase.');
const cloud = mode !== 'local' || process.env.VERCEL === '1';
if (!cloud && process.env.HOST && !['127.0.0.1', 'localhost', '::1'].includes(process.env.HOST)) throw new Error('Public listeners require authenticated aliyun or supabase mode.');
const runtime = cloud ? (await import('./server/cloudRuntime')).createCloudRuntime() : undefined;
const app = createApp(runtime);
app.use('/src/assets/images', express.static(path.join(appRoot, 'src/assets/images')));
app.use('/samples', express.static(path.join(appRoot, 'src/assets/images')));
if (process.env.NODE_ENV === 'production') {
  const distDirectory = path.join(appRoot, 'dist');
  app.use(express.static(distDirectory));
  app.get('*', (_req, res) => res.sendFile(path.join(distDirectory, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: appRoot, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log('Oneiros is listening on http://localhost:' + port + (cloud ? ' (cloud)' : ' (local)')));
server.on('error', (error) => { console.error('Could not start Oneiros:', error.message); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
