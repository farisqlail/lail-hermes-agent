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

// --- headings ----------------------------------------------------------------
// The reported bug: an agent writing `#### A. Fase 1` had the hashes rendered
// literally, because only levels 1-3 were handled.

test('renderMarkdown handles every heading level', () => {
  assert.strictEqual(renderMarkdown('# One'), '<h1>One</h1>');
  assert.strictEqual(renderMarkdown('## Two'), '<h2>Two</h2>');
  assert.strictEqual(renderMarkdown('### Three'), '<h3>Three</h3>');
  assert.strictEqual(renderMarkdown('#### Four'), '<h4>Four</h4>');
  assert.strictEqual(renderMarkdown('##### Five'), '<h5>Five</h5>');
  assert.strictEqual(renderMarkdown('###### Six'), '<h6>Six</h6>');
});

test('renderMarkdown does not treat a deeper hash run as a shallower heading', () => {
  // The old bug in reverse: `####` must not match the `###` rule and leave a
  // stray hash inside the tag.
  assert.strictEqual(renderMarkdown('#### A. Fase 1'), '<h4>A. Fase 1</h4>');
  assert.ok(!renderMarkdown('#### A. Fase 1').includes('#'));
});

test('renderMarkdown leaves seven or more hashes as text', () => {
  const html = renderMarkdown('####### Not a heading');
  assert.ok(!html.includes('<h'));
});

test('renderMarkdown needs a space after the hashes', () => {
  assert.ok(!renderMarkdown('#NotAHeading').includes('<h1>'));
  assert.ok(!renderMarkdown('#hashtag').includes('<h1>'));
});

test('renderMarkdown keeps inline formatting inside a heading', () => {
  assert.strictEqual(renderMarkdown('#### **Bold** head'), '<h4><strong>Bold</strong> head</h4>');
});

// --- emphasis ----------------------------------------------------------------

test('renderMarkdown renders single-asterisk italics', () => {
  assert.strictEqual(renderMarkdown('*Logic:* the rest'), '<em>Logic:</em> the rest');
});

test('renderMarkdown keeps bold and italic apart', () => {
  assert.strictEqual(renderMarkdown('**bold**'), '<strong>bold</strong>');
  // Nesting order is not asserted — `<em><strong>` and `<strong><em>` render
  // and read identically, so pinning one would test the implementation.
  const both = renderMarkdown('***both***');
  assert.ok(both.includes('<strong>') && both.includes('<em>'), both);
  assert.ok(!both.includes('*'), both);
});

test('renderMarkdown does not turn a bullet into an italic run', () => {
  const html = renderMarkdown('* first\n* second');
  assert.ok(!html.includes('<em>'), html);
  assert.ok(html.includes('&bull; first'));
});

test('renderMarkdown leaves snake_case identifiers alone', () => {
  // Underscore emphasis is deliberately unsupported: this is a developer tool
  // and `old_string`/`new_string` in one line would otherwise become italic.
  assert.strictEqual(renderMarkdown('use old_string and new_string'),
    'use old_string and new_string');
});

test('renderMarkdown leaves a lone asterisk alone', () => {
  assert.strictEqual(renderMarkdown('2 * 3 = 6'), '2 * 3 = 6');
});

test('renderMarkdown does not italicise across a line break', () => {
  const html = renderMarkdown('*not closed\nstill not*');
  assert.ok(!html.includes('<em>'), html);
});
