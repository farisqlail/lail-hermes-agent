import React from 'react';

interface MarkdownProps {
  content: string;
}

export function escapeHtml(src: string): string {
  return src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function renderMarkdown(src: string): string {
  let s = escapeHtml(src || '');
  const blocks: string[] = [];
  const SENT = String.fromCharCode(0); // sentinel that user text cannot contain
  
  // Code blocks (fold long code or diffs into compact Edited <> action rows)
  s = s.replace(/```([a-zA-Z0-9_\.\/-]*)\s*([\s\S]*?)```/g, (_, lang, rawCode) => {
    const code = rawCode.replace(/^\n+|\n+$/g, '');
    const lines = code.split('\n');

    const l = (lang || '').toLowerCase();
    const isDiff = l === 'diff' || l === 'patch' || lines.some(line => line.startsWith('+') || line.startsWith('-'));
    const isLong = lines.length > 5;

    if (isDiff || isLong) {
      let added = 0;
      let removed = 0;
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) added++;
        else if (line.startsWith('-') && !line.startsWith('---')) removed++;
      }
      if (added === 0 && removed === 0 && isLong) {
        added = lines.length;
      }

      const fileLabel = lang ? lang.replace(/^(diff|patch)\s*/i, '').trim() : '';
      const cleanLabel = fileLabel || 'Code';

      blocks.push(
        `<details class="action-code-fold">` +
          `<summary class="action-code-summary">` +
            `<span class="action-label">Edited</span> ` +
            `<span class="action-icon">&lt;&gt;</span> ` +
            `<span class="action-name">${cleanLabel}</span> ` +
            `<span class="action-added">+${added}</span> ` +
            `<span class="action-removed">-${removed}</span>` +
            `<span class="action-arrow">&#8250;</span>` +
          `</summary>` +
          `<pre class="md-pre"><code>${code}</code></pre>` +
        `</details>`
      );
    } else {
      blocks.push(`<pre class="md-pre"><code>${code}</code></pre>`);
    }
    return SENT + (blocks.length - 1) + SENT;
  });

  // Action item: Edited <> Name +X -Y (matches Antigravity / Cursor file edits)
  s = s.replace(/^[ \t]*Edited\s*(?:&lt;&gt;|<>)?[ \t]*([^+\-\n\r]+?)[ \t]*\+(\d+)[ \t]*\-(\d+)[ \t]*$/gm,
    (_m, name, added, removed) =>
      `<div class="action-item-edited"><span class="action-label">Edited</span> <span class="action-icon">&lt;&gt;</span> <span class="action-name">${name.trim()}</span> <span class="action-added">+${added}</span> <span class="action-removed">-${removed}</span></div>`
  );

  // Action item: Ran X commands (optional >)
  s = s.replace(/^[ \t]*Ran\s+(\d+\s+commands?)(?:\s*(?:&gt;|>))?[ \t]*$/gm,
    (_m, text) =>
      `<div class="action-item-command-batch"><span class="action-label">Ran ${text}</span> <span class="action-arrow">&#8250;</span></div>`
  );

  // Action item: Ran/Run [command] (optional >)
  s = s.replace(/^[ \t]*(Ran|Run)\s+([^\n\r]+?)(?:\s*(?:&gt;|>))?[ \t]*$/gm,
    (_m, verb, cmd) => {
      const trimmed = cmd.trim();
      if (trimmed.includes('\\') || trimmed.includes('/') || trimmed.startsWith('node ') || trimmed.startsWith('npm ') || trimmed.startsWith('python ') || trimmed.startsWith('git ') || trimmed.startsWith('cargo ') || trimmed.startsWith('cat ') || trimmed.startsWith('ls ') || trimmed.startsWith('cd ')) {
        return `<details class="action-item-command"><summary class="action-command-summary"><span class="action-label">${verb}</span> <span class="action-cmd-text">${trimmed}</span> <span class="action-arrow">&#8250;</span></summary><div class="action-command-detail"><code>${trimmed}</code></div></details>`;
      }
      return _m;
    }
  );

  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
  
  // Bold
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  // Media (before Links, so ![alt](url) is not consumed by the link rule).
  // Only same-origin (/…), http(s), or data:image URLs render — never
  // javascript: or other schemes. A video extension renders a <video> player;
  // everything else renders an <img>.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    if (!/^(https?:\/\/|\/|data:image\/)/.test(url)) return m;
    if (/\.(mp4|webm)(\?|$)/i.test(url)) {
      return `<video src="${url}" controls preload="metadata" style="max-width:100%;height:auto;border-radius:8px;display:block;margin:8px 0;"></video>`;
    }
    return `<img src="${url}" alt="${alt}" loading="lazy" style="max-width:100%;height:auto;border-radius:8px;display:block;margin:8px 0;" />`;
  });

  // Links
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  
  // Headers. One rule for all six levels, deepest-first by construction: the
  // old per-level rules stopped at ### and left `#### Heading` on screen with
  // its hashes, because a four-hash run matches none of `### `, `## `, `# `.
  // Capped at six, which is where the spec stops — `#######` is text.
  s = s.replace(/^[ \t]*(#{1,6}) +(.*)$/gm, (_m, hashes: string, body: string) =>
    `<h${hashes.length}>${body.trim()}</h${hashes.length}>`);

  // Blockquotes
  s = s.replace(/^&gt; (.*)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');

  // Horizontal Rules
  s = s.replace(/^(\s*)---$/gm, '<hr class="md-hr">');

  // Bullet lists
  s = s.replace(/^(\s*)[-*] +(.+)$/gm, '$1&bull; $2');

  // Italics, deliberately after bullets and after bold: a leading `* item` is
  // a list marker, not an opening emphasis, and by here it is already a
  // bullet. Only asterisks — `_` emphasis stays unsupported on purpose, since
  // one line naming `old_string` and `new_string` would otherwise go italic
  // through the middle.
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  
  // Parse Tables
  const lines = s.split('\n');
  const newLines: string[] = [];
  let inTable = false;
  let headers: string[] = [];
  let rows: string[][] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (!inTable) {
        headers = cells;
        inTable = true;
        rows = [];
      } else {
        const isSeparator = cells.every(c => /^:?-+:?$/.test(c));
        if (!isSeparator) {
          rows.push(cells);
        }
      }
    } else {
      if (inTable) {
        let tableHtml = '<table class="md-table"><thead><tr>';
        headers.forEach(h => tableHtml += `<th>${h}</th>`);
        tableHtml += '</tr></thead><tbody>';
        rows.forEach(r => {
          tableHtml += '<tr>';
          r.forEach(c => tableHtml += `<td>${c}</td>`);
          tableHtml += '</tr>';
        });
        tableHtml += '</tbody></table>';
        newLines.push(tableHtml);
        inTable = false;
      }
      newLines.push(lines[i]);
    }
  }
  if (inTable) {
    let tableHtml = '<table class="md-table"><thead><tr>';
    headers.forEach(h => tableHtml += `<th>${h}</th>`);
    tableHtml += '</tr></thead><tbody>';
    rows.forEach(r => {
      tableHtml += '<tr>';
      r.forEach(c => tableHtml += `<td>${c}</td>`);
      tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';
    newLines.push(tableHtml);
  }

  // Handle Newlines correctly to avoid spacing issues after block-level tags
  let finalHtml = '';
  for (let i = 0; i < newLines.length; i++) {
    const line = newLines[i];
    const trimmed = line.trim();
    const isBlock = trimmed.startsWith('<table') ||
                    /^<h[1-6][ >]/.test(trimmed) ||
                    trimmed.startsWith('<blockquote') ||
                    trimmed.startsWith('<hr') ||
                    trimmed.startsWith('<pre') ||
                    trimmed.startsWith('<details') ||
                    trimmed.startsWith('</details') ||
                    trimmed.startsWith('<div class="action-') ||
                    trimmed.startsWith('</table');
    
    finalHtml += line;
    if (i < newLines.length - 1) {
      if (isBlock) {
        finalHtml += '\n';
      } else {
        finalHtml += '<br>';
      }
    }
  }

  // Restore code blocks
  finalHtml = finalHtml.replace(new RegExp(SENT + '(\\d+)' + SENT, 'g'), (_, i) => blocks[+i]);
  
  return finalHtml;
}

export function Markdown({ content }: MarkdownProps) {
  const html = renderMarkdown(content);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
