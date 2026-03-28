/**
 * Trigger all browser feeds individually
 * Usage: node scripts/trigger-browser-feeds.mjs
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fetch } from 'undici';

// Load API key from .env
const envPath = resolve(process.cwd(), '.env');
const envContent = readFileSync(envPath, 'utf-8');
const apiKeyMatch = envContent.match(/^API_KEY=(.+)$/m);
const API_KEY = apiKeyMatch ? apiKeyMatch[1].replace(/^["']|["']$/g, '') : '';

const WORKER_URL = "https://briefings.mikes-briefings.workers.dev";

const browserFeeds = [
  { name: "Adyen Knowledge Hub", url: "https://www.adyen.com/knowledge-hub" },
  { name: "Bessemer Venture Partners (Atlas)", url: "https://www.bvp.com/atlas" },
  { name: "Fireblocks Blog", url: "https://www.fireblocks.com/blog/" },
  { name: "Greylock (Greymatter)", url: "https://greylock.com/greymatter/" },
  { name: "JPMorgan Payments Trends & Innovation", url: "https://www.jpmorgan.com/insights/payments" },
  { name: "Ondo Finance Blog", url: "https://ondo.finance/blog" },
  { name: "Plaid Blog", url: "https://plaid.com/blog/" },
  { name: "Ramp Blog", url: "https://ramp.com/blog" },
  { name: "Securitize News", url: "https://securitize.io/news" },
  { name: "Sequoia Capital Stories", url: "https://www.sequoiacap.com/stories/" },
  { name: "Stripe Newsroom", url: "https://stripe.com/newsroom" },
  { name: "Visa Newsroom", url: "https://usa.visa.com/about-visa/newsroom.html" },
  { name: "a16z News Content", url: "https://a16z.com/news-content/" }
];

console.log(`Triggering ${browserFeeds.length} browser feeds...\n`);

for (const feed of browserFeeds) {
  console.log(`📰 ${feed.name}`);
  try {
    const response = await fetch(`${WORKER_URL}/api/run/feed-fetch`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        feedUrl: feed.url,
        feedName: feed.name
      })
    });

    const data = await response.json();
    if (data.success) {
      const reqId = data.data.requestIds[0].substring(0, 8);
      console.log(`  ✅ Queued: ${reqId}...\n`);
    } else {
      console.log(`  ❌ Error: ${data.error}\n`);
    }
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}\n`);
  }

  // Small delay to avoid overwhelming the queue
  await new Promise(resolve => setTimeout(resolve, 500));
}

console.log(`✨ All browser feeds queued! Browser rendering will take 60-120 seconds.`);
console.log(`   Each feed opens a headless Chrome browser to scrape JavaScript-rendered content.\n`);
