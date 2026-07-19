export interface WebVttCue {
  endTime: number;
  startTime: number;
  text: string;
}

const parseTimestamp = (value: string) => {
  const parts = value.trim().replace(',', '.').split(':');
  if (parts.length < 2 || parts.length > 3) {
    return undefined;
  }

  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(hours)
  ) {
    return undefined;
  }

  return hours * 3600 + minutes * 60 + seconds;
};

const decodeEntities = (value: string) =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lrm;|&rlm;/gi, '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    );

const cleanCueText = (lines: string[]) =>
  decodeEntities(
    lines
      .join('\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).trim();

export const parseWebVtt = (input: string): WebVttCue[] => {
  const normalized = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();

  if (!normalized) {
    return [];
  }

  const cues: WebVttCue[] = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) {
      continue;
    }

    const [rawStart, rawEndAndSettings] = lines[timingIndex].split('-->');
    const rawEnd = rawEndAndSettings?.trim().split(/\s+/, 1)[0];
    const startTime = parseTimestamp(rawStart);
    const endTime = rawEnd ? parseTimestamp(rawEnd) : undefined;
    const text = cleanCueText(lines.slice(timingIndex + 1));

    if (
      startTime !== undefined &&
      endTime !== undefined &&
      endTime > startTime &&
      text
    ) {
      cues.push({endTime, startTime, text});
    }
  }

  return cues.sort((a, b) => a.startTime - b.startTime);
};

export const activeWebVttText = (cues: WebVttCue[], positionSeconds: number) =>
  cues
    .filter(
      (cue) =>
        positionSeconds >= cue.startTime && positionSeconds < cue.endTime,
    )
    .map((cue) => cue.text)
    .join('\n');
