# Oneiros: Multi-Modal Surrealist Dream Journal

A multi-modal dream capture and psychoanalytic synthesis studio. Users can record or draft dreams immediately upon waking, transcribe spoken memories, synthesize high-resolution surrealist artwork embodying core emotional themes using `gemini-3-pro-image-preview`, explore structured Jungian archetype interpretations, and engage in multi-turn dialogues with a specialized depth-psychology chatbot.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following key user preferences were confirmed during the interview phase and are established as core architectural requirements:

- **Psychological Framework**: Jungian Depth Psychology (Shadow, Anima/Animus, Persona, Collective Unconscious, Archetypes, and Individuation).
- **Capture Experience**: Dual Wake Mode offering one-tap audio recording with live waveform visualization alongside an instant text scratchpad.
- **Surrealist Visual Style**: Ethereal classic surrealism inspired by Salvador Dalí and René Magritte (metaphysical horizons, juxtaposition of everyday objects, suspended physics, dream lighting).
- **Image Resolution Affordance**: Configurable 1K, 2K, and 4K resolution options powered by `gemini-3-pro-image-preview`.
- **Multi-Turn Symbol Chat**: Context-aware symbol investigation powered by Gemini with customizable model tiers (`gemini-3.5-flash` for standard analysis, `gemini-3.1-pro-preview` for complex synthesis, and `gemini-3.1-flash-lite` for rapid symbol lookup).

---

## 1. Overview & Core Concept

- **What It Does**: Immediately captures ephemeral morning memories before hypnopompic fading. It transcribes spoken descriptions, extracts unconscious emotional tension, commissions bespoke surrealist imagery (1K/2K/4K), generates a curatorial Jungian report with symbol decoding, and opens an interactive inquiry thread to interrogate symbols and archetypal figures.
- **Target Audience / Persona**: Dream journalers, psychoanalysis enthusiasts, creative writers, therapists, and anyone exploring active imagination and unconscious motifs.
- **Key Value**: Bridges the fragile waking state to permanent reflective insights by pairing effortless voice logging with museum-grade artistic and psychological depth.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Morning Wake Capture**:
   - The user opens the journal at bedside. The prominent Morning Wake Station offers one-tap audio recording with live mic decibel visualization, or direct text input.
   - Recording stops, and the audio is sent to `/api/transcribe` (transcribed via Gemini audio processing).
2. **Analysis & Artwork Synthesis**:
   - The user selects the artwork resolution (1K, 2K, 4K) and aspect ratio.
   - The server routes the transcript to generate both:
     - A structured Jungian interpretation (Emotional Theme, Unconscious Tension, Archetype Breakdown, Symbol Catalog, and Individuation Action).
     - A surrealist prompt executed through `gemini-3-pro-image-preview` reflecting the dream's psychic motif in the style of Dalí and Magritte.
3. **Curatorial Gallery & Deep Reading**:
   - The dream is presented in an editorial gallery format with high-resolution artwork framing, accession metadata, and drop-cap narrative prose.
   - The Archetype & Symbol catalog displays detected entities (e.g., Shadow, The Threshold, Water, The Clock) with clickable anchors.
4. **Interactive Symbol Inquiry Thread**:
   - Clicking any detected symbol or launching the chat panel opens a multi-turn conversation.
   - The assistant is grounded in Jungian active imagination techniques, referencing the specific dream narrative and unconscious themes.
   - Conversation history is preserved per dream in local storage.
5. **Dream Archives & Archetype Explorer**:
   - Users can browse past dreams chronologically, search by symbols or emotions, and view recurring archetypes across their dream history.

### Visual Identity & Curatorial Atmosphere
- **Aesthetic Direction**: Museum Editorial & Curatorial Archival (`references/9_museum_editorial_institutional.md`). Evokes a leather-bound, parchment-toned psychoanalytic case archive with contemporary gallery poise.
- **Color Palette (60-30-10 Rule)**:
  - *Dominant Canvas (60%)*: Archival alabaster & cream (`#FAF8F5` in light mode, `#161514` deep obsidian in dark mode).
  - *Structural Surfaces (30%)*: Muted limestone cards (`#F3EFEA` / `#211F1D`), hairline parchment dividers (`#E7E2DA` / `#2F2C28`), antique charcoal typography (`#1C1917` / `#ECE8E1`).
  - *Curatorial Accents (10%)*: Terracotta (`#9A3412`), Deep Lapis (`#1E3A8A`), and Burnished Amber (`#B45309`).
- **Typography**:
  - *Headings & Titles*: High-contrast editorial serif (`Playfair Display` / `Cinzel` styling via Google Fonts).
  - *Body Prose*: Reading serif (`Lora` / `Source Serif` styling) constrained to 65–75 characters per line (`max-w-prose`).
  - *Metadata & Badges*: Unboxed uppercase typography with tracking and `·` separators (strict zero-pill rule).
- **Motion & Feedback**:
  - Subtle wave animations during recording.
  - Smooth 150ms hover transitions on museum gallery cards.
  - Generous negative space with hairline borders instead of heavy drop shadows or rounded pill badges.

---

## 3. Key Product Decisions & Trade-Offs

- **Server-Side API Architecture**:
  - *Chosen Approach*: Express server backend with server endpoints (`/api/transcribe`, `/api/interpret`, `/api/generate-image`, `/api/chat`) initializing `@google/genai` with `process.env.GEMINI_API_KEY`.
  - *Why*: Strict adherence to Gemini security guidelines (no client-side API keys) and seamless processing of audio buffers and image generation parameters.
- **Audio Capture Strategy**:
  - *Chosen Approach*: Browser `MediaRecorder` API with native WebM/WAV recording, audio visualizer via `AudioContext` AnalyserNode, plus Web Speech API / Gemini audio transcription fallback.
  - *Why*: Allows zero-latency local recording on mobile or desktop browsers while producing high-fidelity audio chunks for transcription.
- **Image Generation with Resolution Affordance**:
  - *Chosen Approach*: Use `gemini-3-pro-image-preview` with an explicit resolution selector (1K, 2K, 4K) and aspect ratio controls. Prompts are automatically enriched with Dalí / Magritte surrealist lighting, atmospheric depth, and symbolic tension.
  - *Why*: Satisfies the explicit requirement for `gemini-3-pro-image-preview` and user-controlled resolution tiers.
- **Multi-Turn Chat with Role-Specific System Instruction**:
  - *Chosen Approach*: Stateful multi-turn chat using Gemini with role instructions designating the assistant as a specialized Jungian Psychoanalyst and Archetype Cartographer. Users can select model performance profiles (`gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-3.1-flash-lite`).
  - *Why*: Fulfills multi-turn chatbot requirements while keeping symbol interpretations deeply grounded in the dream context.

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT BROWSER (React 19)                       │
│                                                                        │
│  ┌───────────────────────┐  ┌────────────────────────────────────────┐ │
│  │   Wake Record Studio  │  │        Curatorial Dream Gallery         │ │
│  │ • Mic MediaRecorder   │  │ • High-Res Surrealist Image View (1-4K) │ │
│  │ • Live Audio Visualizer│  │ • Accession Metadata (Date, Mood, Ego)  │ │
│  │ • Text Scratchpad     │  │ • Structured Jungian Archetype Report   │ │
│  └───────────┬───────────┘  └───────────────────┬────────────────────┘ │
│              │                                  │                      │
│              ▼                                  ▼                      │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │           Interactive Archetype & Symbol Inquiry Chat             │ │
│  │ • Multi-turn conversation thread per dream                        │ │
│  │ • Model Tier: gemini-3.1-pro-preview / 3.5-flash / 3.1-flash-lite │ │
│  │ • Quick Symbol Prompts & Active Imagination Exploration           │ │
│  └──────────────────────────────────┬────────────────────────────────┘ │
│                                     │                                  │
│             LocalStorage            │ Client Fetch Requests            │
│       (Dreams & Chat History)       │ (/api/* endpoints)               │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     BACKEND PROXY (Express / Node.js)                  │
│                                                                        │
│  ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐  │
│  │  POST /api/        │ │  POST /api/        │ │  POST /api/        │  │
│  │  transcribe        │ │  interpret         │ │  generate-image    │  │
│  │ (gemini-3.5-       │ │ (gemini-3.5-flash) │ │ (gemini-3-pro-     │  │
│  │  transcribe)       │ │                    │ │  image-preview)    │  │
│  └─────────┬──────────┘ └─────────┬──────────┘ └─────────┬──────────┘  │
│            │                      │                      │             │
│            └──────────────────────┼──────────────────────┘             │
│                                   ▼                                    │
│                 ┌───────────────────────────────────┐                  │
│                 │       POST /api/chat-symbol       │                  │
│                 │ (Multi-turn Jungian Analyst agent)│                  │
│                 └─────────────────┬─────────────────┘                  │
│                                   │                                    │
│                                   ▼                                    │
│                 ┌───────────────────────────────────┐                  │
│                 │   @google/genai SDK (Server)      │                  │
│                 │   with process.env.GEMINI_API_KEY │                  │
│                 └───────────────────────────────────┘                  │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Model & Entities

```typescript
interface DreamEntry {
  id: string;
  createdAt: string; // ISO string
  title: string;
  transcript: string;
  audioDurationSeconds?: number;
  emotionalTone: string; // e.g., "Haunting Wonder", "Anxious Descent"
  dominantMood: string;
  resolution: "1K" | "2K" | "4K";
  aspectRatio: "1:1" | "4:3" | "16:9";
  imageUrl: string;
  imagePrompt: string;
  interpretation: {
    coreTheme: string;
    unconsciousTension: string;
    archetypes: Array<{
      name: string; // e.g., "The Shadow", "The Anima", "The Threshold Guardian"
      description: string;
      appearanceInDream: string;
    }>;
    symbols: Array<{
      symbol: string; // e.g., "Melting Clock", "Keyless Tower"
      archetypalMeaning: string;
      personalReflectionPrompt: string;
    }>;
    individuationGuidance: string;
  };
  chatHistory: Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
    timestamp: string;
  }>;
}
```

### Interactive Components & State Mapping
- `WakeRecorderModal / Strip`: Manages mic streams, record/pause/stop timers, canvas-based audio wave animation, and one-click transcription.
- `DreamEditor`: Allows reviewing transcribed text, setting image resolution (1K, 2K, 4K), adding waking reflections, and initiating synthesis.
- `DreamDetailView`: Displays the museum artwork card with zoom modal, accession metadata ribbon, audio playback (if recorded), and the complete Jungian analysis.
- `SymbolChatPanel`: Slide-over or inline multi-turn chat panel with model switcher, pre-populated symbol chips for fast questioning, and scrollable conversation history.
- `DreamCatalog`: Grid and list view of all recorded dreams with filter by archetype, date sorting, and export/import options.

---

## 5. Implementation Steps Ahead

1. Update `metadata.json` with app title and description, and configure `index.html` with curatorial fonts (`Playfair Display`, `Plus Jakarta Sans`).
2. Implement server-side proxy routes with `@google/genai` in `server.ts` / Vite server middleware:
   - `/api/transcribe`: Audio transcription via `gemini-3.5-transcribe` with audio base64 payload.
   - `/api/interpret`: JSON schema output for Jungian archetypes, symbols, and Dalí/Magritte surrealist prompt generation.
   - `/api/generate-image`: Calls `gemini-3-pro-image-preview` with configurable `imageSize` ("1K", "2K", "4K") and `aspectRatio`.
   - `/api/chat-symbol`: Multi-turn symbol dialogue supporting user-selected models.
3. Build the frontend components:
   - Live audio recording with waveform animation and text fallback.
   - Museum-grade Dream View with high-resolution artwork viewer and Jungian accession sheet.
   - Interactive Symbol Chat with quick archetype probes and conversation memory.
   - Dream archive list and filter controls.
4. Verify end-to-end compilation with `compile_applet`.
