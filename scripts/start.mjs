import { access } from 'node:fs/promises';

try {
  await access(new URL('../dist/index.html', import.meta.url));
} catch {
  console.error('Production build is missing. Run npm run build, then npm start.');
  process.exit(1);
}
process.env.NODE_ENV = 'production';
await import('../server.ts');
