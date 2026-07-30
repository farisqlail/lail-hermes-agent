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
  
  // Links
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  
  // Bullet lists
  s = s.replace(/^(\s*)[-*] +(.+)$/gm, '$1&bull; $2');
  
  // Newlines
  s = s.replace(/\n/g, '<br>');
  
  // Restore code blocks
  s = s.replace(new RegExp(SENT + '(\\d+)' + SENT, 'g'), (_, i) => blocks[+i]);
  
  return s;
}

export function Markdown({ content }: MarkdownProps) {
  const html = renderMarkdown(content);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
