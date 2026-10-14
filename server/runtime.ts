import type express from 'express';
import type { createDreamStore } from './dreamStore.js';
import type { getAiConfig } from './aiConfig.js';
import type { DreamEntry } from '../src/types.js';

export type ArchiveStore = Omit<ReturnType<typeof createDreamStore>, 'mediaDirectory'> & {
  mediaDirectory?: string;
  count?(): Promise<number>;
  importBatch?(dreams: DreamEntry[]): Promise<{ imported: number; skipped: number; initialized: boolean }>;
  bootstrapBatch?(dreams: DreamEntry[]): Promise<{ imported: number; skipped: number; initialized: boolean }>;
  get?(id: string): Promise<DreamEntry | null>;
  listPage?(options: { offset: number; limit: number }): Promise<{ dreams: DreamEntry[]; hasMore: boolean; nextOffset: number }>;
  signMediaPath?(path: string): Promise<string>;
  readOwnedAudio?(path: string): Promise<{ bytes: Buffer; mimeType: string }>;
};

export interface RequestArchiveContext {
  dreamStore: ArchiveStore;
  aiConfig: ReturnType<typeof getAiConfig>;
}

export interface ArchiveRuntime {
  /** Register public session/login endpoints, then authenticate all remaining APIs. */
  mount(app: express.Express): void;
}
