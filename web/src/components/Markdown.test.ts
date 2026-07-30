import test from 'node:test';
import assert from 'node:assert';
import { renderMarkdown, escapeHtml } from './Markdown';

test('escapeHtml escapes dangerous chars', () => {
  assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
  assert.strictEqual(escapeHtml('"hello"'), '&quot;hello&quot;');
});

test('renderMarkdown converts bold text', () => {
  assert.strictEqual(renderMarkdown('**bold**'), '<strong>bold</strong>');
});

test('renderMarkdown converts inline code', () => {
  assert.strictEqual(renderMarkdown('`code`'), '<code class="md-code">code</code>');
});

test('renderMarkdown converts code blocks and protects content', () => {
  const md = '```\nconst x = 5;\n<script>alert(1)</script>\n```';
  const html = renderMarkdown(md);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('<pre class="md-pre"><code>const x = 5;'));
});
