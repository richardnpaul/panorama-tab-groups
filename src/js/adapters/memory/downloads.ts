import type { Downloads } from '../../ports/downloads.js';

export interface MemoryDownloads extends Downloads {
  /** The files offered so far, in order */
  readonly saved: { filename: string; content: string }[];
}

/** Downloads that only remember what was offered */
export function createMemoryDownloads(): MemoryDownloads {
  const saved: { filename: string; content: string }[] = [];

  return {
    saved,
    saveFile(content, filename) {
      saved.push({ filename, content });
      return Promise.resolve();
    },
  };
}
