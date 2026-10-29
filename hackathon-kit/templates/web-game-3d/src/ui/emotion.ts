import type { Emotion } from '../ai/protocol';

export const EMOTION_EMOJI: Record<Emotion, string> = {
  neutral: '😐',
  happy: '😊',
  angry: '😠',
  suspicious: '🤨',
  sad: '😢',
};

export const EMOTION_LABEL: Record<Emotion, string> = {
  neutral: 'спокоен',
  happy: 'доволен',
  angry: 'злится',
  suspicious: 'подозревает',
  sad: 'грустит',
};

export function relationshipLabel(value: number): string {
  if (value <= -60) return 'Враг';
  if (value <= -20) return 'Неприязнь';
  if (value < 20) return 'Нейтрально';
  if (value < 60) return 'Симпатия';
  return 'Друг';
}
