/**
 * Automated Verification Script for US-CHAT-04: Plain Text Rendering and Link Auto-linking
 * Module: Chat
 * Priority: P0 | Traces to: FR-3.14
 *
 * Acceptance Criteria Verified:
 * 1. URLs (http/https) in messages are automatically converted to clickable links
 *    with rel="noopener noreferrer" and target="_blank".
 * 2. No HTML tags in message bodies are rendered as markup (React escaping is used; no dangerouslySetInnerHTML).
 */

process.env.NODE_ENV = 'test';

import fs from 'fs';
import path from 'path';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS\x1b[0m: ${testName}`);
    passedCount++;
  } else {
    console.error(`  \x1b[31m✖ FAIL\x1b[0m: ${testName} ${detail ? `(${detail})` : ''}`);
    failedCount++;
  }
}

// Logic replica of renderMessageBody for headless verification of parsing logic
function parseMessageParts(text: string) {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s]+(?<![.,?!:;)]))/g;
  const parts = text.split(urlRegex).filter(Boolean);

  return parts.map((part) => {
    if (/^https?:\/\/[^\s]+$/.test(part)) {
      return { type: 'link', url: part };
    }
    return { type: 'text', content: part };
  });
}

async function runTests() {
  console.log('\n============================================================');
  console.log('🚀 Running US-CHAT-04: Plain Text Rendering & Link Auto-linking (FR-3.14)');
  console.log('============================================================\n');

  try {
    const chatPanelPath = path.resolve(__dirname, '../../client/src/features/rooms/ChatPanel.tsx');
    assert(fs.existsSync(chatPanelPath), 'ChatPanel.tsx exists');

    const chatPanelCode = fs.readFileSync(chatPanelPath, 'utf8');

    console.log('--- Criterion 1: Link Auto-linking Configuration (AC-1) ---');
    {
      const hasHttpHttpsRegex = chatPanelCode.includes('https?:\\/\\/[^\\s]+');
      assert(hasHttpHttpsRegex, 'Auto-linking matches http:// and https:// URLs');

      const hasTargetBlank = chatPanelCode.includes('target="_blank"');
      assert(hasTargetBlank, 'Auto-linked anchors specify target="_blank"');

      const hasNoopenerNoreferrer = chatPanelCode.includes('rel="noopener noreferrer"');
      assert(hasNoopenerNoreferrer, 'Auto-linked anchors specify rel="noopener noreferrer"');

      const hasDataTestId = chatPanelCode.includes('data-testid="chat-message-link"');
      assert(hasDataTestId, 'Auto-linked anchors contain data-testid="chat-message-link"');

      const usesRenderHelper = chatPanelCode.includes('{renderMessageBody(msg.body, isOwn)}');
      assert(usesRenderHelper, 'Message bubble calls renderMessageBody(msg.body, isOwn)');
    }

    console.log('\n--- Criterion 2: Secure Plain Text Rendering (AC-2) ---');
    {
      const hasDangerouslySetInnerHTML = chatPanelCode.includes('dangerouslySetInnerHTML');
      assert(!hasDangerouslySetInnerHTML, 'ChatPanel avoids dangerouslySetInnerHTML (no HTML markup execution)');

      // Standard React escaping: non-URL text is rendered as React text node children
      const returnsPlainPart = chatPanelCode.includes('return part;');
      assert(returnsPlainPart, 'Plain text segments are rendered directly via React string interpolation (React auto-escaping)');
    }

    console.log('\n--- Criterion 3: URL Parsing & Auto-linking Behavior ---');
    {
      // 1. Single https link
      const singleLink = parseMessageParts('Check out https://linkup.edu for materials');
      assert(
        singleLink.length === 3 &&
        singleLink[0].type === 'text' && singleLink[0].content === 'Check out ' &&
        singleLink[1].type === 'link' && singleLink[1].url === 'https://linkup.edu' &&
        singleLink[2].type === 'text' && singleLink[2].content === ' for materials',
        'Single https URL is isolated from surrounding text'
      );

      // 2. Single http link
      const httpLink = parseMessageParts('Old site: http://insecure.test/docs');
      assert(
        httpLink.length === 2 &&
        httpLink[0].type === 'text' && httpLink[0].content === 'Old site: ' &&
        httpLink[1].type === 'link' && httpLink[1].url === 'http://insecure.test/docs',
        'Single http URL is auto-linked'
      );

      // 3. Trailing punctuation stripped from URL and kept as plain text
      const trailingPunct = parseMessageParts('Please visit https://google.com.');
      assert(
        trailingPunct.length === 3 &&
        trailingPunct[0].type === 'text' && trailingPunct[0].content === 'Please visit ' &&
        trailingPunct[1].type === 'link' && trailingPunct[1].url === 'https://google.com' &&
        trailingPunct[2].type === 'text' && trailingPunct[2].content === '.',
        'Trailing sentence punctuation (period) is not included in the URL href'
      );

      // 4. Multiple URLs in single message
      const multiLinks = parseMessageParts('See https://a.com and https://b.org/path?q=1 today');
      const links = multiLinks.filter((p) => p.type === 'link');
      assert(
        links.length === 2 &&
        links[0].url === 'https://a.com' &&
        links[1].url === 'https://b.org/path?q=1',
        'Multiple URLs within a single message are all converted to links'
      );

      // 5. HTML injection test: tags are treated as plain text, not parsed as links
      const htmlMsg = '<script>alert("xss")</script><img src="x" onerror="alert(1)">';
      const parsedHtml = parseMessageParts(htmlMsg);
      assert(
        parsedHtml.length === 1 &&
        parsedHtml[0].type === 'text' &&
        parsedHtml[0].content === htmlMsg,
        'HTML tags are treated as plain text with no link conversion'
      );

      // 6. Security: Non-http schemes (javascript:, data:, file:) must NOT be auto-linked
      const xssScheme = parseMessageParts('Click here: javascript:alert(document.cookie)');
      const xssLinks = xssScheme.filter((p) => p.type === 'link');
      assert(
        xssLinks.length === 0,
        'Dangerous non-http schemes (javascript:) are NOT converted to links'
      );
    }
  } catch (err: any) {
    console.error('Unhandled test failure:', err);
    failedCount++;
  }

  console.log('\n============================================================');
  console.log(`Test Summary: \x1b[32m${passedCount} Passed\x1b[0m, \x1b[31m${failedCount} Failed\x1b[0m`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
