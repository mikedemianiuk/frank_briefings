#!/usr/bin/env tsx
/**
 * Bulk import scrape feeds from config/scrape-feeds.yaml
 * Usage: tsx scripts/import-scrape-feeds.ts [--dry-run]
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { execSync } from 'child_process';

interface FeedConfig {
  name: string;
  url: string;
  type: string;
  selector: string;
  category: string;
}

interface Config {
  feeds: FeedConfig[];
}

// Read command line args
const dryRun = process.argv.includes('--dry-run');

console.log('🔍 Bulk Scrape Feed Importer');
console.log('============================\n');

if (dryRun) {
  console.log('🔵 DRY RUN MODE - No changes will be made\n');
}

// Read YAML config
const configPath = resolve(process.cwd(), 'config/scrape-feeds.yaml');
const configContent = readFileSync(configPath, 'utf-8');
const config: Config = parse(configContent);

console.log(`📋 Found ${config.feeds.length} feeds to import\n`);

// Generate SQL for each feed
const now = Date.now();
const sqlStatements: string[] = [];

for (const feed of config.feeds) {
  // Generate UUID (simple random UUID v4)
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

  // Escape single quotes in strings for SQL
  const escapedName = feed.name.replace(/'/g, "''");
  const escapedUrl = feed.url.replace(/'/g, "''");
  const escapedSelector = feed.selector.replace(/'/g, "''");
  const escapedCategory = feed.category.replace(/'/g, "''");

  const sql = `INSERT INTO Feed (id, name, url, type, selector, category, isActive, isValid, errorCount, createdAt, updatedAt)
VALUES ('${uuid}', '${escapedName}', '${escapedUrl}', '${feed.type}', '${escapedSelector}', '${escapedCategory}', 1, 1, 0, ${now}, ${now});`;

  sqlStatements.push(sql);

  console.log(`✓ ${feed.name}`);
  console.log(`  URL: ${feed.url}`);
  console.log(`  Selector: ${feed.selector}`);
  console.log(`  Category: ${feed.category}\n`);
}

if (dryRun) {
  console.log('🔵 DRY RUN - SQL would be:');
  console.log(sqlStatements.join('\n'));
  console.log('\nRun without --dry-run to apply changes');
  process.exit(0);
}

// Prompt for confirmation
console.log(`\n📊 Ready to import ${config.feeds.length} feeds`);
console.log('⚠️  This will add all feeds to your remote database\n');

// In a real CLI, you'd use readline here, but for simplicity:
console.log('Importing feeds...\n');

// Execute SQL in batches of 5 to avoid timeout
const batchSize = 5;
let successCount = 0;
let errorCount = 0;

for (let i = 0; i < sqlStatements.length; i += batchSize) {
  const batch = sqlStatements.slice(i, i + batchSize);
  const batchSql = batch.join('\n');

  try {
    // Use wrangler to execute SQL
    const command = `npx wrangler d1 execute DB --remote --command="${batchSql.replace(/"/g, '\\"')}"`;
    execSync(command, { stdio: 'pipe' });

    successCount += batch.length;
    console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(sqlStatements.length / batchSize)} imported`);
  } catch (error) {
    errorCount += batch.length;
    console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error instanceof Error ? error.message : String(error));
  }
}

console.log('\n📊 Import Summary');
console.log('==================');
console.log(`✅ Successfully imported: ${successCount}`);
console.log(`❌ Failed: ${errorCount}`);
console.log(`📝 Total: ${config.feeds.length}\n`);

if (successCount > 0) {
  console.log('🚀 Next Steps:');
  console.log('1. Test fetch: pnpm trigger feed-fetch');
  console.log('2. View articles: npx wrangler d1 execute DB --remote --command="SELECT name, url FROM Feed WHERE type=\'scrape\' LIMIT 5"');
  console.log('3. Check logs: pnpm tail\n');
}
