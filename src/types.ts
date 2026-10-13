export interface Archetype {
  name: string;
  description: string;
  appearanceInDream: string;
}

export interface DreamSymbol {
  symbol: string;
  archetypalMeaning: string;
  personalReflectionPrompt: string;
}

export interface Interpretation {
  title: string;
  coreTheme: string;
  unconsciousTension: string;
  dominantMood: string;
  archetypes: Archetype[];
  symbols: DreamSymbol[];
  individuationGuidance: string;
  surrealistImagePrompt: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: string;
}

export type ImageResolution = '1K' | '2K' | '4K';
export type AspectRatioOption = '1:1' | '4:3' | '16:9';

export type ChatModelOption = 'gemini-3.1-pro-preview' | 'gemini-3.5-flash' | 'gemini-3.1-flash-lite';

export interface DreamEntry {
  id: string;
  createdAt: string;
  title: string;
  transcript: string;
  audioDurationSeconds?: number;
  emotionalNotes?: string;
  resolution: ImageResolution;
  aspectRatio: AspectRatioOption;
  imageUrl: string;
  imagePrompt: string;
  interpretation: Interpretation;
  chatHistory: ChatMessage[];
  audioUrl?: string;
}
