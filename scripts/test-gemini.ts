#!/usr/bin/env tsx

/**
 * Test Gemini API with gemini-3-pro-preview
 * Reads API key from .env file
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load environment variables from .env
function loadEnv(): { GEMINI_API_KEY: string } {
  const envPath = resolve(process.cwd(), '.env');
  const envContent = readFileSync(envPath, 'utf-8');

  const vars: Record<string, string> = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) {
      vars[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });

  if (!vars.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not found in .env file');
  }

  return { GEMINI_API_KEY: vars.GEMINI_API_KEY };
}

const MODEL = 'gemini-3-pro-preview';

async function testGemini() {
  const env = loadEnv();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  console.log(`Testing Gemini API with model: ${MODEL}\n`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: 'Say hello in one sentence.' }],
            role: 'user',
          },
        ],
        generationConfig: {
          maxOutputTokens: 100,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ API Error:', response.status, response.statusText);
      console.error('Response:', JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log('✅ API Success!');

    // Extract and display the text
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.log('\nGenerated text:');
      console.log(data.candidates[0].content.parts[0].text);
    }
  } catch (error) {
    console.error('❌ Request failed:', error);
    process.exit(1);
  }
}

testGemini();
