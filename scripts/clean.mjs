import { rm } from 'node:fs/promises';
// Only the generated frontend build is removed; the personal data archive is retained.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
