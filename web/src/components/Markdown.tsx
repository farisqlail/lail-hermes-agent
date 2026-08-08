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
  
  // Code blocks
  s = s.replace(/```([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre class="md-pre"><code>${code.replace(/^\n+|\n+$/g, '')}</code></pre>`);
    return SENT + (blocks.length - 1) + SENT;
  });
  
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
  
  // Headers (multiline search)
  s = s.replace(/^(\s*)### (.*)$/gm, '<h3>$2</h3>');
  s = s.replace(/^(\s*)## (.*)$/gm, '<h2>$2</h2>');
  s = s.replace(/^(\s*)# (.*)$/gm, '<h1>$2</h1>');

  // Blockquotes
  s = s.replace(/^&gt; (.*)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');

  // Horizontal Rules
  s = s.replace(/^(\s*)---$/gm, '<hr class="md-hr">');

  // Bullet lists
  s = s.replace(/^(\s*)[-*] +(.+)$/gm, '$1&bull; $2');
  
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
                    trimmed.startsWith('<h1') || 
                    trimmed.startsWith('<h2') || 
                    trimmed.startsWith('<h3') || 
                    trimmed.startsWith('<blockquote') || 
                    trimmed.startsWith('<hr') ||
                    trimmed.startsWith('<pre') ||
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
