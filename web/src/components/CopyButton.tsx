import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Copy one message to the clipboard.
 *
 * Selection alone is enough for a sentence, but a whole reply is long, often
 * scrolls, and mixing rendered markdown into a drag-select picks up the
 * surrounding chrome. This copies exactly the text the message was built from.
 *
 * `navigator.clipboard` needs a secure context; 127.0.0.1 qualifies, so the
 * dashboard is fine — but the Electron shell and any future LAN access are not
 * guaranteed to be, hence the execCommand fallback rather than a silent
 * failure on the one action whose entire purpose is to hand text over. */
export function CopyButton({ text, label = 'Copy', className = '' }: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const flash = () => {
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1400);
  };

  const copy = async (e: React.MouseEvent) => {
    // The bubble may sit inside a clickable row; copying is not navigating.
    e.stopPropagation();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flash();
      return;
    } catch {
      // Fall through to the legacy path below.
    }
    try {
      const scratch = document.createElement('textarea');
      scratch.value = text;
      // Off-screen rather than hidden: a display:none textarea cannot be
      // selected, which is what the fallback depends on.
      scratch.style.position = 'fixed';
      scratch.style.left = '-9999px';
      document.body.appendChild(scratch);
      scratch.select();
      document.execCommand('copy');
      document.body.removeChild(scratch);
      flash();
    } catch {
      // Nothing left to try; the text stays selectable by hand.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`copy-btn ${copied ? 'copied' : ''} ${className}`.trim()}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : label}
    </button>
  );
}
