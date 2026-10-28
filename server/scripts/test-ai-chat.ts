// server/scripts/test-ai-chat.ts
import { generateAiChatResponse } from '../src/lib/ai';

async function runAiTests() {
  console.log('🧪 Starting AI Assistant Backend Integration Smoke Tests...\n');

  // Test 1: Socratic Query
  console.log('Test 1: Standard Query ("How do I reverse a singly linked list in Python?")');
  try {
    const res = await generateAiChatResponse({
      prompt: 'How do I reverse a singly linked list in Python?',
    });
    console.log('✅ Response Received:');
    console.log(`- Model: ${res.model}`);
    console.log(`- Tokens: ${JSON.stringify(res.usage)}`);
    console.log(`- Snippet: ${res.response.slice(0, 160)}...\n`);
  } catch (err: any) {
    console.log(`ℹ️ Test 1 Result: ${err.message}`);
  }

  // Test 2: Code Context Debugging
  console.log('Test 2: Code Context Debugging');
  const buggyCode = `
def divide_numbers(a, b):
    return a / b

print(divide_numbers(10, 0))
  `.trim();

  try {
    const res = await generateAiChatResponse({
      prompt: 'Why is this function crashing when I run it?',
      codeContext: buggyCode,
    });
    console.log('✅ Response Received:');
    console.log(`- Snippet: ${res.response.slice(0, 160)}...\n`);
  } catch (err: any) {
    console.log(`ℹ️ Test 2 Result: ${err.message}`);
  }

  console.log('\n🏁 AI Smoke test run completed.');
}

runAiTests();

