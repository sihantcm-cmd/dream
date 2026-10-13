import React, { useState, useRef, useEffect } from 'react';
import {
  Mic, Square, Sparkles, X, FileText, RefreshCw, Sliders, AlertCircle, CornerDownLeft,
} from 'lucide-react';
import type { ImageResolution, AspectRatioOption, DreamEntry, Interpretation } from '../types';
import { transcribeAudio, interpretDream, generateSurrealistImage, getHealth } from '../services/api';
import type { BackendHealth } from '../services/api';
import { prepareTranscriptionAudio } from '../services/audio';
import { nativeImageDimensions, resolutionLabel } from '../services/imageOptions';

interface WakeRecorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDreamCreated: (dream: DreamEntry) => Promise<void> | void;
}

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const DRAFT_STORAGE_KEY = 'oneiros_pending_draft_v1';

function readTextDraft(): { transcript: string; emotionalNotes: string } {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_STORAGE_KEY) || '{}');
    return {
      transcript: typeof draft.transcript === 'string' ? draft.transcript.slice(0, 30_000) : '',
      emotionalNotes: typeof draft.emotionalNotes === 'string' ? draft.emotionalNotes.slice(0, 4_000) : '',
    };
  } catch { return { transcript: '', emotionalNotes: '' }; }
}

function audioAsDataUrl(blob: Blob): Promise<string> {
  if (blob.size > MAX_AUDIO_BYTES) return Promise.reject(new Error('Recordings must be 20 MB or smaller.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('The recording could not be read.'));
    reader.onerror = () => reject(new Error('The recording could not be read.'));
    reader.readAsDataURL(blob);
  });
}

export const WakeRecorderModal: React.FC<WakeRecorderModalProps> = ({ isOpen, onClose, onDreamCreated }) => {
  const [initialDraft] = useState(readTextDraft);
  const [isClosing, setIsClosing] = useState(false);
  const [activeMode, setActiveMode] = useState<'voice' | 'text'>('voice');
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparingRecording, setIsPreparingRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState(initialDraft.transcript);
  const [emotionalNotes, setEmotionalNotes] = useState(initialDraft.emotionalNotes);
  const [resolution, setResolution] = useState<ImageResolution>('native');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('1:1');
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisStage, setSynthesisStage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const canTranscribe = health?.capabilities.transcribe === true;
  const canInterpret = health?.capabilities.interpret === true;
  const canGenerateImage = health?.capabilities.image === true;
  const resolutions = health?.imageOptions.resolutions || ['native' as ImageResolution];

  const mountedRef = useRef(true);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;
  const operationRef = useRef<'starting' | 'finishing' | 'transcribing' | 'saving' | null>(null);
  const permissionVersionRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoTranscribeRef = useRef(false);
  const timerIntervalRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const synthesisAbortRef = useRef<AbortController | null>(null);
  const lastTranscriptionRef = useRef<{ blob: Blob; text: string } | null>(null);
  const entryIdentityRef = useRef<{ id: string; createdAt: string } | null>(null);
  const generationCacheRef = useRef<{
    textKey?: string; interpretation?: Interpretation; imageKey?: string; imageUrl?: string;
  }>({});
  const isBusy = isSynthesizing || isTranscribing || isPreparingRecording;

  const stopVisualizer = () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    analyserRef.current = null;
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
  };

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerIntervalRef.current !== null) window.clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
    stopVisualizer();
  };

  const stopRecording = (transcribe = true) => {
    autoTranscribeRef.current = transcribe;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      operationRef.current = 'finishing';
      setIsPreparingRecording(true);
      recorder.stop();
    }
    stopTracks();
    setIsRecording(false);
  };

  const cancelTranscription = () => {
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    if (operationRef.current === 'transcribing') operationRef.current = null;
    setIsTranscribing(false);
  };

  const pauseCapture = () => {
    permissionVersionRef.current += 1;
    if (operationRef.current === 'starting') {
      operationRef.current = null;
      setIsPreparingRecording(false);
    }
    cancelTranscription();
    stopRecording(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      permissionVersionRef.current += 1;
      transcriptionAbortRef.current?.abort();
      synthesisAbortRef.current?.abort();
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        recorder.ondataavailable = null;
        recorder.onerror = null;
        if (recorder.state !== 'inactive') recorder.stop();
      }
      stopTracks();
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      if (transcript || emotionalNotes) {
        sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ transcript, emotionalNotes }));
      } else sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch { /* The in-memory draft still works when browser storage is unavailable. */ }
  }, [transcript, emotionalNotes]);

  useEffect(() => {
    if (!isOpen) { pauseCapture(); return; }
    let active = true;
    getHealth().then((status) => {
      if (!active) return;
      setHealth(status);
      setResolution((current) => status.imageOptions.resolutions.includes(current) ? current : status.imageOptions.resolutions[0]);
    }).catch(() => { if (active) setHealth(null); });
    return () => { active = false; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isRecording || activeMode !== 'voice') return;
    const draw = () => {
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas || !analyser) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const values = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(values);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = canvas.width / values.length;
      ctx.fillStyle = '#1C1917';
      values.forEach((value, index) => {
        const height = Math.max(3, value / 255 * canvas.height * 0.85);
        ctx.fillRect(index * barWidth, (canvas.height - height) / 2, barWidth - 2, height);
      });
      animationFrameRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isOpen, isRecording, activeMode]);

  const handleAnimateClose = () => {
    if (isClosing || operationRef.current === 'saving') return;
    openRef.current = false;
    pauseCapture();
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      onClose();
      if (mountedRef.current) setIsClosing(false);
    }, 380);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleAnimateClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isClosing, isSynthesizing]);

  const switchMode = (mode: 'voice' | 'text') => {
    if (operationRef.current === 'saving') return;
    pauseCapture();
    setActiveMode(mode);
  };

  const formatTime = (seconds: number) =>
    `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  const handleTranscribe = async (blob: Blob) => {
    if (operationRef.current || !openRef.current || !canTranscribe || !health) return;
    const controller = new AbortController();
    transcriptionAbortRef.current = controller;
    operationRef.current = 'transcribing';
    setIsTranscribing(true);
    setErrorMessage(null);
    try {
      const prepared = await prepareTranscriptionAudio(blob, health.transcriptionOptions);
      const base64Audio = await audioAsDataUrl(prepared);
      if (controller.signal.aborted) return;
      const text = (await transcribeAudio(base64Audio, prepared.type.split(';')[0], controller.signal)).trim();
      if (controller.signal.aborted || !mountedRef.current || !openRef.current) return;
      if (!text) throw new Error('Transcription returned no words. You can enter your dream below.');
      const previous = lastTranscriptionRef.current;
      setTranscript((current) => {
        if (previous?.blob === blob) {
          const index = current.lastIndexOf(previous.text);
          return index >= 0
            ? current.slice(0, index) + text + current.slice(index + previous.text.length)
            : current; // Keep manual edits when the original transcription has been replaced.
        }
        return current ? `${current}\n\n${text}` : text;
      });
      if (previous?.blob === blob && !transcript.includes(previous.text)) {
        setErrorMessage('The transcript was edited manually. Your edits were kept; start a new recording to append more.');
      } else lastTranscriptionRef.current = { blob, text };
    } catch (error) {
      if (!controller.signal.aborted && mountedRef.current) {
        setErrorMessage(error instanceof Error ? error.message : 'Transcription failed. You can type your dream below.');
      }
    } finally {
      if (transcriptionAbortRef.current === controller) {
        transcriptionAbortRef.current = null;
        operationRef.current = null;
        if (mountedRef.current) setIsTranscribing(false);
      }
    }
  };

  const startRecording = async () => {
    if (operationRef.current || isRecording || isClosing) return;
    operationRef.current = 'starting';
    setIsPreparingRecording(true);
    setErrorMessage(null);
    const version = ++permissionVersionRef.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Voice recording requires a supported browser on localhost or HTTPS. Use Direct Draft to type instead.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (version !== permissionVersionRef.current || !mountedRef.current || !openRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const supportedMime = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, supportedMime ? { mimeType: supportedMime } : undefined);
      const chunks: Blob[] = [];
      let bytes = 0;
      let tooLarge = false;
      autoTranscribeRef.current = false;
      recorder.ondataavailable = (event) => {
        bytes += event.data.size;
        if (bytes > MAX_AUDIO_BYTES) {
          tooLarge = true;
          if (recorder.state !== 'inactive') stopRecording(false);
          return;
        }
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stopTracks();
        mediaRecorderRef.current = null;
        operationRef.current = null;
        if (!mountedRef.current) return;
        setIsRecording(false);
        setIsPreparingRecording(false);
        if (tooLarge) {
          setErrorMessage('This recording exceeded 20 MB. Please make a shorter recording or enter your dream as text.');
          return;
        }
        const mimeType = (recorder.mimeType || chunks[0]?.type || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type: mimeType });
        if (!blob.size) { setErrorMessage('No audio was captured. Please try again.'); return; }
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setAudioBlob(blob);
        setAudioUrl(url);
        if (autoTranscribeRef.current && openRef.current && canTranscribe) void handleTranscribe(blob);
      };
      recorder.onerror = () => {
        autoTranscribeRef.current = false;
        stopRecording(false);
        setErrorMessage('The recording was interrupted. Please retry or enter your dream as text.');
      };
      mediaRecorderRef.current = recorder;
      // A visualizer failure must not prevent a usable voice recording.
      try {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 64;
        context.createMediaStreamSource(stream).connect(analyser);
        audioContextRef.current = context;
        analyserRef.current = analyser;
      } catch { /* Recording remains available without the waveform. */ }
      recorder.start(250);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setAudioBlob(null);
      setAudioUrl(null);
      setRecordingSeconds(0);
      setIsRecording(true);
      operationRef.current = null;
      const startedAt = Date.now();
      timerIntervalRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setRecordingSeconds(elapsed);
        // Stop just before the service limit, leaving room for the recorder's final audio frame.
        const limit = health?.transcriptionOptions.maxDurationSeconds;
        if (limit && elapsed >= Math.max(1, limit - 1)) stopRecording(canTranscribe);
      }, 250);
    } catch (error) {
      if (version === permissionVersionRef.current && mountedRef.current) {
        stopTracks();
        mediaRecorderRef.current = null;
        setErrorMessage(error instanceof Error ? error.message : 'Microphone access failed. You can type your dream instead.');
      }
    } finally {
      if (version === permissionVersionRef.current) {
        if (operationRef.current === 'starting') operationRef.current = null;
        if (mountedRef.current) setIsPreparingRecording(false);
      }
    }
  };

  const clearSavedDraft = () => {
    setTranscript('');
    setEmotionalNotes('');
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingSeconds(0);
    setErrorMessage(null);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    lastTranscriptionRef.current = null;
    entryIdentityRef.current = null;
    generationCacheRef.current = {};
    try { sessionStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* Optional recovery storage. */ }
  };

  const saveDream = async (withAI: boolean) => {
    if (operationRef.current || isRecording || isClosing || !transcript.trim()) return;
    if (withAI && !canInterpret) return;
    operationRef.current = 'saving';
    const controller = new AbortController();
    synthesisAbortRef.current = controller;
    setIsSynthesizing(true);
    setErrorMessage(null);
    try {
      let interpretation: Interpretation = {
        title: transcript.trim().split('\n')[0].slice(0, 80),
        coreTheme: 'Not analyzed yet / 尚未进行 AI 解读',
        unconsciousTension: 'Not analyzed yet / 尚未进行 AI 解读',
        dominantMood: 'Not analyzed yet / 尚未进行 AI 解读',
        archetypes: [], symbols: [],
        individuationGuidance: 'Not analyzed yet / 尚未进行 AI 解读',
        surrealistImagePrompt: '',
      };
      let imageUrl = '';
      if (withAI) {
        const textKey = JSON.stringify([transcript.trim(), emotionalNotes.trim()]);
        const cache = generationCacheRef.current;
        if (cache.textKey !== textKey || !cache.interpretation) {
          setSynthesisStage('Exploring dream themes & symbols...');
          interpretation = await interpretDream(transcript.trim(), emotionalNotes.trim(), controller.signal);
          generationCacheRef.current = { textKey, interpretation };
        } else interpretation = cache.interpretation;
        if (canGenerateImage) {
          const imageKey = JSON.stringify([textKey, interpretation.surrealistImagePrompt, resolution, aspectRatio]);
          if (generationCacheRef.current.imageKey !== imageKey || !generationCacheRef.current.imageUrl) {
            setSynthesisStage(`Creating ${resolutionLabel(resolution)} surrealist artwork...`);
            const result = await generateSurrealistImage(interpretation.surrealistImagePrompt, resolution, aspectRatio, controller.signal);
            generationCacheRef.current.imageKey = imageKey;
            generationCacheRef.current.imageUrl = result.imageUrl;
          }
          imageUrl = generationCacheRef.current.imageUrl!;
        }
      }
      setSynthesisStage('Saving your dream & recording...');
      const savedAudioUrl = audioBlob ? await audioAsDataUrl(audioBlob) : undefined;
      entryIdentityRef.current ||= { id: `dream-${crypto.randomUUID()}`, createdAt: new Date().toISOString() };
      const dream: DreamEntry = {
        ...entryIdentityRef.current,
        status: withAI ? 'complete' : 'draft',
        title: interpretation.title || 'Untitled Awakening',
        transcript: transcript.trim(),
        emotionalNotes: emotionalNotes.trim() || undefined,
        audioDurationSeconds: audioBlob ? recordingSeconds : undefined,
        resolution, aspectRatio, imageUrl,
        imagePrompt: interpretation.surrealistImagePrompt,
        interpretation, chatHistory: [], audioUrl: savedAudioUrl,
      };
      await onDreamCreated(dream);
      if (!mountedRef.current) return;
      clearSavedDraft();
      setIsClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        onClose();
        if (mountedRef.current) setIsClosing(false);
      }, 380);
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted) {
        setErrorMessage(error instanceof Error ? error.message : 'Your dream could not be saved. The draft is still here; please retry.');
      }
    } finally {
      operationRef.current = null;
      synthesisAbortRef.current = null;
      if (mountedRef.current) {
        setIsSynthesizing(false);
        setSynthesisStage('');
      }
    }
  };

  const handleSynthesize = () => saveDream(true);

  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSynthesizing && !isClosing) {
          handleAnimateClose();
        }
      }}
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/65 backdrop-blur-md overflow-y-auto transition-all ${
        isClosing ? 'animate-backdrop-out' : 'animate-backdrop-in'
      }`}
    >
      <div
        className={`relative w-full max-w-3xl my-6 bg-[#FAF8F5] border border-[#DCD6CA] rounded-xl shadow-2xl overflow-hidden text-[#1C1917] ${
          isClosing ? 'animate-dream-out' : 'animate-dream-in'
        }`}
      >
        {/* Header */}
        <div className="px-6 sm:px-8 pt-7 pb-5 border-b border-[#E7E2DA] flex items-center justify-between gap-4 bg-[#F6F2EC]">
          <div>
            <div className="text-xs uppercase tracking-widest text-[#78716C] font-cinzel mb-1">
              Morning Awakening Station
            </div>
            <h2 className="font-editorial text-2xl sm:text-3xl font-semibold text-[#1C1917]">
              Log Morning Dream
            </h2>
          </div>

          {/* Prominent High-Visibility Close Button */}
          <button
            onClick={handleAnimateClose}
            disabled={isSynthesizing || isClosing}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold uppercase tracking-wider text-[#1C1917] bg-[#FAF8F5] hover:bg-[#1C1917] hover:text-[#FAF8F5] border-2 border-[#1C1917] rounded-lg transition-all duration-200 shadow-sm cursor-pointer group active:scale-95 disabled:opacity-40"
            title="Awaken & Close (ESC)"
            aria-label="Close modal"
          >
            <X className="w-4 h-4 transition-transform group-hover:rotate-90" />
            <span>Close</span>
            <kbd className="hidden sm:inline-block text-[10px] bg-black/10 group-hover:bg-white/20 px-1.5 py-0.5 rounded font-mono font-medium">
              ESC
            </kbd>
          </button>
        </div>

        {/* Mode Selector Tabs (Clean segmented control) */}
        <div className="px-6 sm:px-8 pt-6">
          <div className="flex items-center gap-1 p-1 bg-[#ECE7DE] rounded-lg max-w-xs">
            <button
              onClick={() => switchMode('voice')}
              disabled={isSynthesizing || isClosing}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-md transition-all ${
                activeMode === 'voice'
                  ? 'bg-[#FAF8F5] text-[#1C1917] shadow-xs'
                  : 'text-[#78716C] hover:text-[#1C1917]'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Voice Record</span>
            </button>
            <button
              onClick={() => switchMode('text')}
              disabled={isSynthesizing || isClosing}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-md transition-all ${
                activeMode === 'text'
                  ? 'bg-[#FAF8F5] text-[#1C1917] shadow-xs'
                  : 'text-[#78716C] hover:text-[#1C1917]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Direct Draft</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <fieldset disabled={isSynthesizing || isClosing} className="p-6 sm:p-8 space-y-6 max-h-[68vh] overflow-y-auto min-w-0">
          <div className="text-xs text-[#78716C] leading-relaxed" role="status">
            {health
              ? `解读${canInterpret ? '已配置' : '待配置'} · 转写${canTranscribe ? '已配置' : '待配置'} · 绘图${canGenerateImage ? '已配置' : '待配置'}。文字与录音均可直接保存到本机。`
              : '正在获取 AI 配置状态。文字与录音均可直接保存到本机。'}
            {canInterpret && !canGenerateImage && <span className="block mt-1">可先完成梦境解读，配置绘图服务后再补充画作。</span>}
            <span className="block mt-1">录音上限 20 MB{health?.transcriptionOptions.maxDurationSeconds ? `，每段最长 ${Math.floor(health.transcriptionOptions.maxDurationSeconds / 60)} 分钟` : ''}。文字草稿保留在当前浏览器标签页。</span>
          </div>
          {/* Error Banner */}
          {errorMessage && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3 text-xs text-amber-900 leading-relaxed">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="flex-1">{errorMessage}</div>
            </div>
          )}

          {/* Voice Mode Station */}
          {activeMode === 'voice' && (
            <div className="p-6 bg-[#F3EFEA] border border-[#E2DCD1] rounded-xl text-center space-y-5">
              <div className="flex flex-col items-center justify-center">
                {isRecording ? (
                  <button
                    onClick={() => stopRecording()}
                    className="w-20 h-20 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95 cursor-pointer ring-4 ring-red-200 animate-pulse"
                    aria-label="Stop recording"
                  >
                    <Square className="w-7 h-7 fill-white" />
                  </button>
                ) : (
                  <button
                    onClick={startRecording}
                    disabled={isBusy || isClosing}
                    className="w-20 h-20 rounded-full bg-[#1C1917] hover:bg-[#2F2B28] text-[#FAF8F5] flex items-center justify-center shadow-lg transition-transform active:scale-95 cursor-pointer ring-4 ring-[#E2DCD1]"
                    aria-label="Start recording"
                  >
                    <Mic className="w-8 h-8 text-[#FAF8F5]" />
                  </button>
                )}

                <div className="mt-4 font-mono text-xl font-semibold text-[#1C1917] tabular-nums">
                  {formatTime(recordingSeconds)}
                </div>
                <div className="text-xs text-[#78716C] mt-1">
                  {isRecording
                    ? 'Recording dream details... Tap to finish & transcribe.'
                    : audioBlob
                    ? 'Recording ready. Record again to replace this clip, or review the transcript below.'
                    : 'Tap microphone immediately upon waking while memories are vivid.'}
                </div>
              </div>

              {/* Canvas Waveform */}
              {isRecording && (
                <div className="w-full flex justify-center py-2">
                  <canvas
                    ref={canvasRef}
                    width={280}
                    height={40}
                    className="rounded bg-[#FAF8F5]/80 border border-[#E2DCD1]"
                  />
                </div>
              )}

              {/* Playback preview if recorded */}
              {audioUrl && !isRecording && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <audio src={audioUrl} controls className="h-9 max-w-xs" />
                  <button
                    onClick={() => audioBlob && handleTranscribe(audioBlob)}
                    disabled={isBusy || !canTranscribe}
                    className="px-3 py-1.5 text-xs font-semibold text-[#1C1917] bg-[#FAF8F5] hover:bg-[#EAE4D9] border border-[#D8D2C5] rounded-md flex items-center gap-1.5 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTranscribing ? 'animate-spin' : ''}`} />
                    <span>Re-transcribe</span>
                  </button>
                </div>
              )}

              {isTranscribing && (
                <div className="text-xs font-medium text-[#78716C] animate-pulse flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#B45309]" />
                  <span>正在逐字转写录音…</span>
                </div>
              )}
            </div>
          )}

          {/* Transcript Field */}
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wider font-semibold text-[#57534E]">
              Dream Narrative & Symbols
            </label>
            <textarea
              rows={4}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              disabled={isBusy || isRecording}
              maxLength={30000}
              placeholder="Describe what occurred, who was present, unusual spatial physics, recurring symbols, colors, transformations, and sensations..."
              className="w-full p-4 bg-white border border-[#DCD6CA] rounded-lg text-sm text-[#1C1917] placeholder:text-[#A8A29E] focus:outline-none focus:ring-2 focus:ring-[#1C1917] transition-all font-body-serif leading-relaxed"
            />
          </div>

          {/* Emotional Notes Field */}
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wider font-semibold text-[#57534E]">
              Initial Feeling upon Waking <span className="text-[#A8A29E] font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              value={emotionalNotes}
              onChange={(e) => setEmotionalNotes(e.target.value)}
              disabled={isBusy || isRecording}
              maxLength={4000}
              placeholder="e.g. Haunting nostalgia, awe, unresolvable guilt, sudden weightlessness..."
              className="w-full px-4 py-2.5 bg-white border border-[#DCD6CA] rounded-lg text-sm text-[#1C1917] placeholder:text-[#A8A29E] focus:outline-none focus:ring-2 focus:ring-[#1C1917] transition-all"
            />
          </div>

          {/* Image Generation Affordances (Resolution & Aspect Ratio) */}
          <div className="p-5 bg-[#F6F3EE] border border-[#E4DFD5] rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#78716C]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[#1C1917]">
                  Surrealist Artwork Commission
                </span>
              </div>
              <span className="text-xs text-[#78716C]">Dali & Magritte Aesthetic</span>
            </div>

            {/* Show only sizes supported by the configured image provider. */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#57534E]">
                Image Resolution Affordance:
              </label>
              <div className="grid grid-cols-3 gap-2">
                {resolutions.map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => setResolution(res)}
                    className={`py-2 px-3 text-xs font-semibold rounded-md border text-center transition-all cursor-pointer ${
                      resolution === res
                        ? 'bg-[#1C1917] text-[#FAF8F5] border-[#1C1917] shadow-xs'
                        : 'bg-white text-[#57534E] border-[#DCD6CA] hover:border-[#1C1917]'
                    }`}
                  >
                    <div className="font-mono text-sm">{resolutionLabel(res)}</div>
                    <div className="text-[10px] opacity-75">
                      {res === 'native' ? nativeImageDimensions(aspectRatio, health?.imageOptions.dimensions) : res === '1K' ? 'Standard 1024px' : res === '2K' ? 'Enhanced 2048px' : 'Master 4096px'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect Ratio Selector */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#57534E]">
                Composition Framing:
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: '1:1', label: '1:1 Square (Gallery)' },
                  { id: '4:3', label: '4:3 Classical' },
                  { id: '16:9', label: '16:9 Horizon' },
                ].filter((item) => !health || health.imageOptions.aspectRatios.includes(item.id as AspectRatioOption)).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setAspectRatio(item.id as AspectRatioOption)}
                    className={`py-2 px-3 text-xs font-medium rounded-md border text-center transition-all cursor-pointer ${
                      aspectRatio === item.id
                        ? 'bg-[#1C1917] text-[#FAF8F5] border-[#1C1917]'
                        : 'bg-white text-[#57534E] border-[#DCD6CA] hover:border-[#1C1917]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </fieldset>

        {/* Footer Actions */}
        <div className="px-6 sm:px-8 py-5 border-t border-[#E7E2DA] bg-[#FAF8F5] flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleAnimateClose}
            disabled={isSynthesizing || isClosing}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#78716C] hover:text-[#1C1917] hover:bg-[#EAE4D9] rounded-md transition-colors disabled:opacity-50 border border-transparent hover:border-[#D5CEC2]"
          >
            <CornerDownLeft className="w-3.5 h-3.5" />
            <span>Cancel & Return</span>
          </button>

          <button
            type="button"
            onClick={() => void saveDream(false)}
            disabled={isBusy || isRecording || !transcript.trim() || isClosing}
            className="px-4 py-3 text-xs font-semibold border border-[#1C1917] rounded-lg hover:bg-[#EAE4D9] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save without AI · 直接保存
          </button>

          <button
            type="button"
            onClick={handleSynthesize}
            disabled={isBusy || isRecording || !transcript.trim() || isClosing || !canInterpret}
            className="flex items-center gap-2.5 px-6 py-3 text-xs font-semibold tracking-wider uppercase text-[#FAF8F5] bg-[#1C1917] hover:bg-[#2F2B28] active:scale-[0.98] transition-all rounded-md shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSynthesizing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-[#D6CEBE]" />
                <span>{synthesisStage || 'Synthesizing Dream...'}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-[#D6CEBE]" />
                <span>{canGenerateImage ? '生成解读与梦境画作' : '解读梦境并保存'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
