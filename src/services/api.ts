import {
  ChatMessage,
  ChatModelOption,
  DreamEntry,
  ImageResolution,
  Interpretation,
  AspectRatioOption,
} from '../types';

export async function transcribeAudio(audioBase64: string, mimeType: string = 'audio/webm'): Promise<string> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, mimeType }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Transcription failed with HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.transcript || '';
}

export async function interpretDream(
  transcript: string,
  emotionalNotes?: string
): Promise<Interpretation> {
  const res = await fetch('/api/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, emotionalNotes }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Interpretation failed with HTTP ${res.status}`);
  }

  return res.json();
}

export async function generateSurrealistImage(
  prompt: string,
  imageSize: ImageResolution = '1K',
  aspectRatio: AspectRatioOption = '1:1'
): Promise<{ imageUrl: string; imageSize: string; aspectRatio: string }> {
  const res = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, imageSize, aspectRatio }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Artwork generation failed with HTTP ${res.status}`);
  }

  return res.json();
}

export async function sendSymbolChatMessage(
  messages: Array<{ role: 'user' | 'model'; content: string }>,
  dreamContext: DreamEntry,
  modelName: ChatModelOption = 'gemini-3.5-flash'
): Promise<string> {
  const res = await fetch('/api/chat-symbol', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      dreamContext: {
        title: dreamContext.title,
        transcript: dreamContext.transcript,
        coreTheme: dreamContext.interpretation?.coreTheme,
        unconsciousTension: dreamContext.interpretation?.unconsciousTension,
        archetypes: dreamContext.interpretation?.archetypes,
        symbols: dreamContext.interpretation?.symbols,
      },
      modelName,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Symbol consultation failed with HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.reply || '';
}
