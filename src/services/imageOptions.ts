import type { AspectRatioOption, ImageResolution } from '../types';

export const resolutionLabel = (resolution: ImageResolution) => resolution === 'native' ? '原生尺寸' : resolution;

export function nativeImageDimensions(aspectRatio: AspectRatioOption, dimensions?: Partial<Record<AspectRatioOption, [number, number]>>) {
  const size = dimensions?.[aspectRatio];
  return size ? `${size[0]} × ${size[1]} px` : '模型原生尺寸';
}
