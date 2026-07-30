export interface StreamEvent {
  delta?: string;
  usage?: { total: number };
  error?: string;
}

export function parseStreamBuffer(buffer: string): { events: StreamEvent[]; remaining: string } {
  const events: StreamEvent[] = [];
  let remaining = buffer;
  let idx: number;

  while ((idx = remaining.indexOf('\n\n')) >= 0) {
    const raw = remaining.slice(0, idx);
    remaining = remaining.slice(idx + 2);
    
    // Normalize data: prefix
    const line = raw.replace(/^data:\s?/, '').trim();
    if (!line) continue;
    
    try {
      const parsed = JSON.parse(line);
      events.push(parsed);
    } catch (e) {
      console.warn('Gagal men-parse event stream line:', line, e);
    }
  }

  return { events, remaining };
}
