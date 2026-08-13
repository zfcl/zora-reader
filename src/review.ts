export type ReviewRating = 'again' | 'hard' | 'good';

export interface ReviewState {
  interval: number;
  ease: number;
  lapses: number;
}

export interface ReviewUpdate extends ReviewState {
  due: string;
  status: 'learning' | 'review';
}

export function nextReview(state: ReviewState, rating: ReviewRating, now = new Date()): ReviewUpdate {
  let interval: number;
  let ease = state.ease || 2.5;
  let lapses = state.lapses || 0;
  if (rating === 'again') {
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
    lapses += 1;
  } else if (rating === 'hard') {
    interval = Math.max(2, Math.round((state.interval || 1) * 1.2));
    ease = Math.max(1.3, ease - 0.15);
  } else {
    interval = state.interval <= 0 ? 3 : Math.max(3, Math.round(state.interval * ease));
    ease = Math.min(3, ease + 0.1);
  }
  const due = new Date(now);
  due.setHours(12, 0, 0, 0);
  due.setDate(due.getDate() + interval);
  return { due: localDate(due), ease, interval, lapses, status: rating === 'again' ? 'learning' : 'review' };
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
