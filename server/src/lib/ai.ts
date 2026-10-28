import Groq from 'groq-sdk';
import { env } from '../config/env';
import { AiChatRequest, AiChatResponse } from '@linkup/shared';

export const AI_TEACHING_ASSISTANT_SYSTEM_PROMPT = `
You are the LinkUp AI Teaching Assistant — a friendly, supportive coding buddy for students and teachers in the LinkUp virtual classroom.

CRITICAL RULES FOR ALL REPLIES:
1. Keep it SHORT & CONCISE:
   - Deliver quick, bite-sized answers (aim for 2 to 4 sentences, or 2 to 3 quick bullet points).
   - Never write long walls of text, long essays, or filler intros/outros.
   - Get straight to the helpful answer immediately!

2. Friendly & Encouraging Tone:
   - Talk like a warm, cheerful, and patient friend who loves helping people learn.
   - Be positive and encouraging with a friendly emoji (e.g., 👋, 💡, 🚀).

3. Simple & Plain Language:
   - Use simple, everyday words that anyone can easily understand.
   - Avoid complicated academic jargon. If a technical term is needed, explain it simply.

4. Language Accuracy (CRITICAL):
   - ALWAYS answer in the EXACT programming language the user asks about.
   - If the user asks about Java, ONLY provide Java code (e.g. System.out.println). NEVER show Python or any other language.
   - If the user asks about Python, ONLY write Python code. Never mix languages.
   - NEVER substitute or compare a different language unless the user explicitly asks for a comparison.
   - Code block tags MUST match the language: use ```java for Java, ```python for Python, ```javascript for JavaScript, etc.

5. Code Guidance:
   - Give a short, simple explanation with a tiny correct code snippet in the right language when needed.
   - Always use proper markdown code blocks matching the discussed language.
`.trim();

const GROQ_FALLBACK_MODELS = [
  'qwen/qwen3.8-27b',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'llama-3.1-70b-versatile',
];

/**
 * Execute chat completion via Groq or fallback Gemini API.
 */
export async function generateAiChatResponse(
  payload: AiChatRequest
): Promise<AiChatResponse> {
  const { prompt, codeContext, history = [] } = payload;

  // 1. Validate API Key Availability
  if (!env.GROQ_API_KEY && !env.GEMINI_API_KEY) {
    throw new Error('AI_KEY_MISSING: No valid GROQ_API_KEY or GEMINI_API_KEY configured on server.');
  }

  // 2. Build Contextual Prompt
  let contextualUserPrompt = prompt;
  if (codeContext && codeContext.trim().length > 0) {
    contextualUserPrompt = `[Current Workspace Code Context]:\n\`\`\`\n${codeContext.slice(0, 15000)}\n\`\`\`\n\n[Student Question]:\n${prompt}`;
  }

  // 3. Groq API Implementation (Primary)
  if (env.GROQ_API_KEY) {
    const groq = new Groq({ apiKey: env.GROQ_API_KEY });
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: AI_TEACHING_ASSISTANT_SYSTEM_PROMPT },
      ...history.slice(-6).map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: contextualUserPrompt },
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), env.AI_REQUEST_TIMEOUT_MS);

    // Prepare model candidates list (configured model first, then fallbacks)
    const primaryModel = env.GROQ_MODEL || 'qwen/qwen3.8-27b';
    const modelsToTry = [primaryModel, ...GROQ_FALLBACK_MODELS.filter((m) => m !== primaryModel)];

    let lastGroqError: any = null;

    for (const modelCandidate of modelsToTry) {
      try {
        const completion = await groq.chat.completions.create(
          {
            messages,
            model: modelCandidate,
            temperature: 0.6,
            max_tokens: 600,
          },
          { signal: controller.signal }
        );

        clearTimeout(timeoutId);

        const reply = completion.choices[0]?.message?.content || 'I could not generate a response. Please try again.';

        return {
          response: reply,
          model: completion.model || modelCandidate,
          usage: {
            promptTokens: completion.usage?.prompt_tokens,
            completionTokens: completion.usage?.completion_tokens,
            totalTokens: completion.usage?.total_tokens,
          },
        };
      } catch (err: any) {
        lastGroqError = err;
        if (err.name === 'AbortError' || err.code === 'ETIMEDOUT') {
          clearTimeout(timeoutId);
          throw new Error('AI_TIMEOUT: The AI model took too long to respond. Please try a simpler request.');
        }
        if (err.status === 429) {
          clearTimeout(timeoutId);
          throw new Error('AI_RATE_LIMIT: Model rate limit reached. Please wait a few seconds before trying again.');
        }
        // If 404 (model not found), loop to try next model in fallback list
        if (err.status === 404 || err.message?.includes('model_not_found')) {
          console.warn(`[AI Service] Model "${modelCandidate}" unavailable on Groq, trying next fallback...`);
          continue;
        }
        break;
      }
    }

    clearTimeout(timeoutId);
    if (!env.GEMINI_API_KEY) {
      throw new Error(`AI_UPSTREAM_ERROR: ${lastGroqError?.message || 'Groq API request failed.'}`);
    }
  }

  // 4. Gemini API Implementation (Alternative / Fallback)
  if (env.GEMINI_API_KEY) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), env.AI_REQUEST_TIMEOUT_MS);

    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: AI_TEACHING_ASSISTANT_SYSTEM_PROMPT }],
          },
          contents: [
            ...history.slice(-6).map((h) => ({
              role: h.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: h.content }],
            })),
            {
              role: 'user',
              parts: [{ text: contextualUserPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 600,
          },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(`AI_UPSTREAM_ERROR: Gemini error ${response.status} - ${JSON.stringify(errJson)}`);
      }

      const data = (await response.json()) as any;
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response returned from Gemini.';

      return {
        response: reply,
        model: env.GEMINI_MODEL,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('AI_TIMEOUT: The Gemini API timed out.');
      }
      throw err;
    }
  }

  throw new Error('AI_KEY_MISSING: Missing valid API credentials.');
}
