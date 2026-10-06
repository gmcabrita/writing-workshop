/** Words per minute used for the reading time estimate. */
const READING_WPM = 230;

export interface TextStats {
  readonly characters: number;
  /** Whole minutes, at least 1 when there is any text. */
  readonly readingMinutes: number;
  readonly words: number;
}

export const textStats = (text: string): TextStats => {
  const trimmed = text.trim();
  const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length;

  return {
    characters: trimmed.length,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / READING_WPM)),
    words,
  };
};

export const formatStats = (stats: TextStats): string =>
  stats.words === 0
    ? "0 words"
    : `${stats.words.toLocaleString()} words · ${stats.readingMinutes} min`;
