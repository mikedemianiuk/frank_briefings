#!/usr/bin/env tsx
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseFeedsConfig } from './src/lib/config.js';

const FEEDS_YAML_PATH = resolve(process.cwd(), 'config/feeds.yaml');
const yamlContent = readFileSync(FEEDS_YAML_PATH, 'utf-8');
const yamlFeeds = parseFeedsConfig(yamlContent);

// Check the first few FinTech 50 feeds
const testFeeds = yamlFeeds.filter(f =>
  f.name === 'Plaid Blog' ||
  f.name === 'Stripe Blog' ||
  f.name === 'Ramp Blog'
);

console.log('Feeds from YAML:');
testFeeds.forEach(feed => {
  console.log(`- ${feed.name}`);
  console.log(`  URL: ${feed.url}`);
  console.log(`  Type: ${feed.type || 'rss'}`);
  console.log(`  Selector: ${feed.selector || 'none'}`);
  console.log('');
});
