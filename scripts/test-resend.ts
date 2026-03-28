#!/usr/bin/env tsx

/**
 * Test Resend email sending
 * Reads API key from .env file
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load environment variables from .env
function loadEnv(): { RESEND_API_KEY: string } {
  const envPath = resolve(process.cwd(), '.env');
  const envContent = readFileSync(envPath, 'utf-8');

  const vars: Record<string, string> = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) {
      vars[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });

  if (!vars.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not found in .env file');
  }

  return { RESEND_API_KEY: vars.RESEND_API_KEY };
}

async function testResend() {
  const env = loadEnv();
  const url = 'https://api.resend.com/emails';

  console.log('Testing Resend API...\n');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'briefings@mikedteaches.com',
        to: ['mikedteaches@gmail.com', 'kenyon.cory@gmail.com', 'rhtsrinivas@gmail.com'],
        subject: '[Briefings] Test Email',
        html: '<h1>Test Email</h1><p>This is a test email from Briefings.</p>',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ API Error:', response.status, response.statusText);
      console.error('Response:', JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log('✅ Email sent successfully!');
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ Request failed:', error);
    process.exit(1);
  }
}

testResend();
