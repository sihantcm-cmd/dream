import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  Square,
  Sparkles,
  X,
  FileText,
  Volume2,
  RefreshCw,
  Sliders,
  AlertCircle,
  CornerDownLeft,
} from 'lucide-react';
import { ImageResolution, AspectRatioOption, DreamEntry } from '../types';
import { transcribeAudio, interpretDream, generateSurrealistImage } from '../services/api';

interface WakeRecorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDreamCreated: (dream: DreamEntry) => void;
}

export const WakeRecorderModal: React.FC<WakeRecorderModalProps> = ({
  isOpen,
  onClose,
  onDreamCreated,
}) => {
  const [isClosing, setIsClosing] = useState(false);

  // Mode: voice or text
  const [activeMode, setActiveMode] = useState<'voice' | 'text'>('voice');

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Dream content
  const [transcript, setTranscript] = useState('');
  const [emotionalNotes, setEmotionalNotes] = useState('');

  // Artwork resolution affordance (explicitly 1K, 2K, 4K)
  const [resolution, setResolution] = useState<ImageResolution>('2K');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('1:1');

  // Synthesis loading and error state
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisStage, setSynthesisStage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs for recording & canvas visualizer
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      stopVisualizer();
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // Keyboard shortcut: ESC to trigger animated dissolution
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSynthesizing) {
        handleAnimateClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSynthesizing]);

  const handleAnimateClose = () => {
    if (isClosing || isSynthesizing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 380);
  };

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Start Voice Recording
  const startRecording = async () => {
    setErrorMessage(null);
    audioChunksRef.current = [];
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Setup audio analyzer for waveform visualizer
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      // Setup MediaRecorder
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const supportedMime = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) || '';
      const recorder = new MediaRecorder(stream, supportedMime ? { mimeType: supportedMime } : undefined);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const fullBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        setAudioBlob(fullBlob);
        const url = URL.createObjectURL(fullBlob);
        setAudioUrl(url);

        // Stop all tracks in stream
        stream.getTracks().forEach((track) => track.stop());
        stopVisualizer();

        // Automatically trigger AI Transcription
        await handleTranscribe(fullBlob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);

      // Start timer
      timerIntervalRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);

      // Start canvas waveform
      startVisualizer();
    } catch (err: any) {
      console.error('Microphone access failed:', err);
      setErrorMessage(
        'Unable to access microphone. Please ensure microphone permissions are granted, or switch to the Direct Draft tab.'
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  };

  const startVisualizer = () => {
    const draw = () => {
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas || !analyser) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height * 0.85;

        // Warm ink & amber palette
        ctx.fillStyle = '#1C1917';
        ctx.fillRect(x, (canvas.height - barHeight) / 2, barWidth - 1, Math.max(barHeight, 3));

        x += barWidth;
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
  };

  const stopVisualizer = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  // Transcribe recorded audio
  const handleTranscribe = async (blob: Blob) => {
    setIsTranscribing(true);
    setErrorMessage(null);
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const base64Audio = await base64Promise;
      const text = await transcribeAudio(base64Audio, blob.type);
      if (text) {
        setTranscript((prev) => (prev ? `${prev}\n\n${text}` : text));
      } else {
        setErrorMessage('Transcription returned an empty response. You can type or edit your transcript below.');
      }
    } catch (err: any) {
      console.error('Transcription error:', err);
      setErrorMessage('Audio transcription was unavailable. Please type your dream details in the box below.');
    } finally {
      setIsTranscribing(false);
    }
  };

  // Full Synthesis: Interpretation + Surrealist Artwork Generation
  const handleSynthesize = async () => {
    if (!transcript.trim()) {
      setErrorMessage('Please record or enter your dream description before synthesizing.');
      return;
    }

    setIsSynthesizing(true);
    setErrorMessage(null);

    try {
      // Step 1: Psychological & Archetype Interpretation
      setSynthesisStage('Decoding Jungian archetypes & unconscious tensions...');
      const interpretation = await interpretDream(transcript, emotionalNotes);

      // Step 2: High-Resolution Surrealist Artwork Generation
      setSynthesisStage(`Synthesizing ${resolution} surrealist artwork in Dalí & Magritte aesthetic...`);
      const imageResult = await generateSurrealistImage(
        interpretation.surrealistImagePrompt,
        resolution,
        aspectRatio
      );

      // Build new DreamEntry
      const newDream: DreamEntry = {
        id: `dream-${Date.now()}`,
        createdAt: new Date().toISOString(),
        title: interpretation.title || 'Untitled Awakening',
        transcript: transcript.trim(),
        audioDurationSeconds: recordingSeconds > 0 ? recordingSeconds : undefined,
        emotionalNotes: emotionalNotes.trim() || undefined,
        resolution,
        aspectRatio,
        imageUrl: imageResult.imageUrl,
        imagePrompt: interpretation.surrealistImagePrompt,
        interpretation,
        chatHistory: [],
        audioUrl: audioUrl || undefined,
      };

      onDreamCreated(newDream);
      setIsClosing(true);
      setTimeout(() => {
        onClose();
        setIsClosing(false);
      }, 380);
    } catch (err: any) {
      console.error('Synthesis failed:', err);
      setErrorMessage(
        err.message || 'Dream synthesis encountered an issue. Please verify your transcript and retry.'
      );
    } finally {
      setIsSynthesizing(false);
      setSynthesisStage('');
    }
  };

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
              onClick={() => setActiveMode('voice')}
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
              onClick={() => setActiveMode('text')}
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
        <div className="p-6 sm:p-8 space-y-6 max-h-[68vh] overflow-y-auto">
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
                    onClick={stopRecording}
                    className="w-20 h-20 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95 cursor-pointer ring-4 ring-red-200 animate-pulse"
                    aria-label="Stop recording"
                  >
                    <Square className="w-7 h-7 fill-white" />
                  </button>
                ) : (
                  <button
                    onClick={startRecording}
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
                    ? 'Recording saved. Speak more or review transcript below.'
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
                    disabled={isTranscribing}
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
                  <span>Gemini transcribing audio verbatim...</span>
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
                  Surrealist Artwork Commission (gemini-3-pro-image-preview)
                </span>
              </div>
              <span className="text-xs text-[#78716C]">Dali & Magritte Aesthetic</span>
            </div>

            {/* Resolution Selector: Explicit 1K, 2K, 4K affordance */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#57534E]">
                Image Resolution Affordance:
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['1K', '2K', '4K'] as ImageResolution[]).map((res) => (
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
                    <div className="font-mono text-sm">{res}</div>
                    <div className="text-[10px] opacity-75">
                      {res === '1K' ? 'Standard 1024px' : res === '2K' ? 'Enhanced 2048px' : 'Master 4096px'}
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
                ].map((item) => (
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
        </div>

        {/* Footer Actions */}
        <div className="px-6 sm:px-8 py-5 border-t border-[#E7E2DA] bg-[#FAF8F5] flex items-center justify-between gap-4">
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
            onClick={handleSynthesize}
            disabled={isSynthesizing || !transcript.trim() || isClosing}
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
                <span>Synthesize Surrealist Dream & Analysis</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
