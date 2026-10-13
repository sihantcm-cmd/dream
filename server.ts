import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const app = express();
const port = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Shared Gemini client utility on the server
const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// 1. Audio Transcription Endpoint
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audioBase64, mimeType } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    const ai = getAiClient();
    const cleanBase64 = audioBase64.includes(',')
      ? audioBase64.split(',')[1]
      : audioBase64;
    const cleanMimeType = mimeType || 'audio/webm';

    try {
      // Primary: gemini-3.5-transcribe
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: cleanMimeType,
                data: cleanBase64,
              },
            },
            {
              text: 'Transcribe this dream voice recording verbatim. Return only the transcribed spoken words without commentary or formatting labels.',
            },
          ],
        },
      });

      return res.json({ transcript: response.text?.trim() || '' });
    } catch (transcribeError) {
      console.warn('gemini-3.5-transcribe error, trying gemini-3.5-flash fallback:', transcribeError);
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: cleanMimeType,
                data: cleanBase64,
              },
            },
            {
              text: 'Transcribe this spoken dream recording faithfully into text. Return only the transcription.',
            },
          ],
        },
      });
      return res.json({ transcript: fallbackResponse.text?.trim() || '' });
    }
  } catch (err: any) {
    console.error('Transcription failed:', err);
    res.status(500).json({ error: err.message || 'Failed to transcribe audio' });
  }
});

// 2. Structured Jungian Interpretation & Surrealist Prompt Endpoint
app.post('/api/interpret', async (req, res) => {
  try {
    const { transcript, emotionalNotes } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'Dream transcript is required' });
    }

    const ai = getAiClient();

    const promptText = `Analyze the following morning dream transcript according to Carl Jung's depth psychology and psychoanalytic archetype theory.
Also create a prompt for generating a museum-grade surrealist painting representing the dream's core emotional theme in the ethereal style of Salvador Dalí and René Magritte.

Dream Transcript:
"""
${transcript}
"""
${emotionalNotes ? `Dreamer's Initial Feeling / Notes: "${emotionalNotes}"` : ''}

Provide a comprehensive, structured psychoanalytic synthesis.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: promptText,
      config: {
        systemInstruction: `You are an eminent Jungian psychoanalyst and surrealist art historian.
You interpret dreams through the lens of Carl Jung's analytical psychology: the Personal and Collective Unconscious, the Shadow, Anima/Animus, the Persona, the Self, Archetypal motifs, and the Individuation journey.
You also devise vivid, museum-grade visual prompts in the ethereal surrealist tradition of Salvador Dalí and René Magritte (metaphysical horizons, juxtaposition of everyday objects, suspended physics, dream lighting, symbolic metamorphosis, rich atmospheric depth, fine oil painting textures).`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: 'A poetic, evocative title for the dream in curatorial exhibition style',
            },
            coreTheme: {
              type: Type.STRING,
              description: 'The core unconscious emotional theme and conflict of the dream',
            },
            unconsciousTension: {
              type: Type.STRING,
              description: 'The psychic friction between the waking ego and repressed unconscious contents',
            },
            dominantMood: {
              type: Type.STRING,
              description: 'Primary emotional and affective atmosphere (e.g., Luminous Nostalgia, Anxious Threshold, Melancholic Rebirth)',
            },
            archetypes: {
              type: Type.ARRAY,
              description: '2 to 4 prominent Jungian archetypes detected in the dream narrative',
              items: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.STRING,
                    description: 'Archetype name (e.g., The Shadow, The Anima, The Animus, The Persona, The Threshold Guardian, The Wise Old Guide, The Trickster, The Self)',
                  },
                  description: {
                    type: Type.STRING,
                    description: 'Psychological significance and function of this archetype in depth psychology',
                  },
                  appearanceInDream: {
                    type: Type.STRING,
                    description: 'How this archetype specifically manifested or operated in the dream scenario',
                  },
                },
                required: ['name', 'description', 'appearanceInDream'],
              },
            },
            symbols: {
              type: Type.ARRAY,
              description: '3 to 5 notable symbols from the dream',
              items: {
                type: Type.OBJECT,
                properties: {
                  symbol: {
                    type: Type.STRING,
                    description: 'The specific object, creature, action, or environment',
                  },
                  archetypalMeaning: {
                    type: Type.STRING,
                    description: 'Universal and mythological depth meaning of this symbol',
                  },
                  personalReflectionPrompt: {
                    type: Type.STRING,
                    description: 'A contemplative question for the dreamer to explore in waking life',
                  },
                },
                required: ['symbol', 'archetypalMeaning', 'personalReflectionPrompt'],
              },
            },
            individuationGuidance: {
              type: Type.STRING,
              description: 'Practical active imagination advice and waking-life integration exercise for individuation',
            },
            surrealistImagePrompt: {
              type: Type.STRING,
              description: 'Detailed prompt for an ethereal surrealist oil painting inspired by Salvador Dalí and René Magritte, representing the core emotional theme with symbolic objects, vast metaphysical horizons, and uncanny dream lighting.',
            },
          },
          required: [
            'title',
            'coreTheme',
            'unconsciousTension',
            'dominantMood',
            'archetypes',
            'symbols',
            'individuationGuidance',
            'surrealistImagePrompt',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json(parsed);
  } catch (err: any) {
    console.error('Interpretation failed:', err);
    res.status(500).json({ error: err.message || 'Failed to interpret dream' });
  }
});

// 3. Surrealist Image Generation Endpoint
// Uses gemini-3-pro-image-preview with user-specified image resolution (1K, 2K, 4K)
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, imageSize = '1K', aspectRatio = '1:1' } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Image prompt is required' });
    }

    const validSizes = ['1K', '2K', '4K'];
    const selectedSize = validSizes.includes(imageSize) ? imageSize : '1K';
    const validAspectRatios = ['1:1', '4:3', '16:9', '3:4', '9:16'];
    const selectedRatio = validAspectRatios.includes(aspectRatio) ? aspectRatio : '1:1';

    const ai = getAiClient();

    // Augment prompt to ensure ethereal classic surrealism inspired by Dali & Magritte
    const styledPrompt = `${prompt}. Ethereal classic surrealism masterpiece in the tradition of Salvador Dalí and René Magritte. Metaphysical vast horizon, pristine dream lighting, exquisite oil painting texture, symbolic juxtaposition, uncanny poetry, sublime composition, museum quality exhibition art.`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: {
          parts: [{ text: styledPrompt }],
        },
        config: {
          imageConfig: {
            aspectRatio: selectedRatio,
            imageSize: selectedSize,
          },
        },
      });

      let imageUrl: string | null = null;
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            imageUrl = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
            break;
          }
        }
      }

      if (!imageUrl) {
        throw new Error('No image was returned from gemini-3-pro-image-preview');
      }

      return res.json({ imageUrl, imageSize: selectedSize, aspectRatio: selectedRatio });
    } catch (primaryErr: any) {
      console.warn('gemini-3-pro-image-preview failed, attempting fallback to gemini-3.1-flash-lite-image:', primaryErr);
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-image',
        contents: {
          parts: [{ text: styledPrompt }],
        },
        config: {
          imageConfig: {
            aspectRatio: selectedRatio,
          },
        },
      });

      let fallbackImageUrl: string | null = null;
      if (fallbackResponse.candidates?.[0]?.content?.parts) {
        for (const part of fallbackResponse.candidates[0].content.parts) {
          if (part.inlineData) {
            fallbackImageUrl = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
            break;
          }
        }
      }

      if (!fallbackImageUrl) {
        throw primaryErr;
      }

      return res.json({ imageUrl: fallbackImageUrl, imageSize: '1K (Fallback)', aspectRatio: selectedRatio });
    }
  } catch (err: any) {
    console.error('Image generation failed:', err);
    res.status(500).json({ error: err.message || 'Failed to generate surrealist artwork' });
  }
});

// 4. Multi-Turn Symbol Inquiry Chat Endpoint
// Supports:
// - gemini-3.1-pro-preview (complex tasks)
// - gemini-3.5-flash (general tasks, default)
// - gemini-3.1-flash-lite (fast tasks)
app.post('/api/chat-symbol', async (req, res) => {
  try {
    const { messages, dreamContext, modelName = 'gemini-3.5-flash' } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const ai = getAiClient();

    const allowedModels = ['gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
    const chosenModel = allowedModels.includes(modelName) ? modelName : 'gemini-3.5-flash';

    const systemInstruction = `You are a distinguished Jungian psychoanalyst and depth psychologist assisting a dreamer with active imagination and symbolic exploration.
You are investigating a specific dream entry from the dreamer's journal:
- Title: "${dreamContext?.title || 'Recorded Dream'}"
- Dream Transcript: "${dreamContext?.transcript || ''}"
- Core Emotional Theme: "${dreamContext?.coreTheme || ''}"
- Unconscious Tension: "${dreamContext?.unconsciousTension || ''}"
- Detected Archetypes: ${JSON.stringify(dreamContext?.archetypes || [])}
- Detected Symbols: ${JSON.stringify(dreamContext?.symbols || [])}

Your Role and Guidelines:
1. Ground every answer in Carl Jung's analytical psychology (the Shadow, Anima/Animus, archetypal motifs, mythic parallels, personal vs collective unconscious, and Active Imagination).
2. Deeply explore the specific symbol, character, or sensation the user asks about, examining why their unconscious selected this image.
3. Be intellectually rigorous, warm, curatorial, and reflective.
4. Conclude your responses with a thought-provoking inquiry or a short active imagination prompt that invites the dreamer to dialogue directly with the symbol.
5. Do not offer medical, psychiatric, or diagnostic advice; frame all observations as symbolic psychological inquiry.`;

    // Map conversation history to Gemini contents format
    const contents = messages.map((m: { role: string; content: string }) => ({
      role: m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await ai.models.generateContent({
      model: chosenModel,
      contents,
      config: {
        systemInstruction,
      },
    });

    const reply = response.text || '';
    return res.json({ reply, modelUsed: chosenModel });
  } catch (err: any) {
    console.error('Symbol chat failed:', err);
    res.status(500).json({ error: err.message || 'Failed to generate psychoanalytic reply' });
  }
});

// Vite middleware in dev or static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('dist'));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve('dist', 'index.html'));
  });
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});
