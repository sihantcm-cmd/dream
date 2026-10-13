/** Encode mono 16-bit PCM without uploading the recording or installing an audio codec. */
export function encodeMonoWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  if (!channels.length || !channels[0].length || !Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error('录音中没有可读取的音频。请重新录制。');
  }
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) throw new Error('录音声道长度不一致。');
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true);
  writeText(8, 'WAVE'); writeText(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeText(36, 'data'); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const average = channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length;
    const sample = Math.max(-1, Math.min(1, Number.isFinite(average) ? average : 0));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export async function prepareTranscriptionAudio(
  blob: Blob,
  options: { requiresWav: boolean; maxDurationSeconds: number; maxBase64Bytes: number },
): Promise<Blob> {
  if (!options.requiresWav) return blob;
  if (typeof OfflineAudioContext === 'undefined') throw new Error('当前浏览器无法转换录音格式。请使用新版 Chrome 或 Edge，或直接输入梦境。');
  let decoded: AudioBuffer;
  try {
    // decodeAudioData resamples to this context's rate; averaging channels below produces mono PCM.
    const context = new OfflineAudioContext(1, 1, 16_000);
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error('浏览器无法读取这段录音。原录音仍可保存，请重新录制或直接输入梦境。');
  }
  if (!decoded.length || decoded.duration > options.maxDurationSeconds) {
    throw new Error(`转写录音须在 ${Math.floor(options.maxDurationSeconds / 60)} 分钟内。原录音仍可保存，请录制更短的片段。`);
  }
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel));
  const wav = encodeMonoWav(channels, decoded.sampleRate);
  if (4 * Math.ceil(wav.byteLength / 3) > options.maxBase64Bytes) {
    throw new Error('转换后的录音超过转写服务大小限制。请录制更短的片段。');
  }
  return new Blob([wav], { type: 'audio/wav' });
}
