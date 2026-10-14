import { createAliyunRuntime } from './aliyunRuntime';
import { createSupabaseRuntime } from './supabaseRuntime';

export function createCloudRuntime() {
  // Vercel is stateless. A mistaken environment variable must not enable disk storage there.
  if (process.env.VERCEL === '1') return createSupabaseRuntime();
  if (process.env.ARCHIVE_MODE === 'aliyun') return createAliyunRuntime();
  return createSupabaseRuntime();
}
