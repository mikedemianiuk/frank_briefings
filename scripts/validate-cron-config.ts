#!/usr/bin/env tsx

/**
 * Validates that cron expressions in wrangler.toml match
 * expected handlers in src/index.ts
 *
 * This prevents silent failures where cron triggers don't fire
 * because the expression format is invalid or doesn't match handlers.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Expected cron expressions and their handlers
 * NOTE: Cloudflare Workers uses 7 for Sunday, not 0
 */
const EXPECTED_CRONS = {
  '0 */4 * * *': 'feedFetchCron',
  '0 10 * * *': 'dailySummaryCron',
  '0 6 * * *': 'validateFeedsCron',
  '0 13 * * 7': 'weeklyDigestCron',  // Must be 7 for Sunday, not 0
  '0 */6 * * *': 'healthMonitorCron',  // Every 6 hours
  '0 9 1 * *': 'monthlyReportCron',  // 1st of month
};

function validateCronSyntax(cron: string): { valid: boolean; error?: string } {
  // Check for invalid text day-of-week
  const parts = cron.split(' ');
  if (parts.length !== 5) {
    return { valid: false, error: `Invalid cron format (expected 5 parts): ${cron}` };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Check for text day-of-week (not supported by Cloudflare)
  const invalidDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (invalidDays.includes(dayOfWeek)) {
    return {
      valid: false,
      error: `Day-of-week must be numeric (1-7), not "${dayOfWeek}". Use 7 for Sunday, not 0.`,
    };
  }

  // Warn about 0 for Sunday (Cloudflare uses 7)
  if (dayOfWeek === '0') {
    return {
      valid: false,
      error: `Day-of-week is 0 (Sunday) - Cloudflare Workers requires 7 for Sunday, not 0. Use "0 13 * * 7" instead.`,
    };
  }

  // Validate numeric ranges
  const validateRange = (value: string, min: number, max: number, name: string): boolean => {
    if (value === '*') return true;
    if (value.includes('/')) {
      const [base, interval] = value.split('/');
      if (base !== '*' && (parseInt(base) < min || parseInt(base) > max)) return false;
      return true;
    }
    if (value.includes('-')) {
      const [start, end] = value.split('-');
      return parseInt(start) >= min && parseInt(end) <= max;
    }
    const num = parseInt(value);
    return num >= min && num <= max;
  };

  if (!validateRange(minute, 0, 59, 'minute')) {
    return { valid: false, error: `Invalid minute value: ${minute}` };
  }
  if (!validateRange(hour, 0, 23, 'hour')) {
    return { valid: false, error: `Invalid hour value: ${hour}` };
  }
  if (!validateRange(dayOfMonth, 1, 31, 'day of month')) {
    return { valid: false, error: `Invalid day of month value: ${dayOfMonth}` };
  }
  if (!validateRange(month, 1, 12, 'month')) {
    return { valid: false, error: `Invalid month value: ${month}` };
  }
  if (!validateRange(dayOfWeek, 1, 7, 'day of week')) {
    return { valid: false, error: `Invalid day of week value: ${dayOfWeek} (use 1-7, where 7 = Sunday)` };
  }

  return { valid: true };
}

function extractCronsFromWrangler(): string[] {
  const wranglerPath = resolve(process.cwd(), 'wrangler.toml');

  try {
    const wranglerContent = readFileSync(wranglerPath, 'utf-8');

    // Extract cron expressions from crons array
    const cronMatch = wranglerContent.match(/crons\s*=\s*\[([\s\S]*?)\]/);
    if (!cronMatch) {
      console.error('❌ Could not find crons array in wrangler.toml');
      return [];
    }

    const cronLines = cronMatch[1]
      .split('\n')
      .map((line) => {
        // Remove comments and trim
        const cleanedLine = line.split('#')[0].trim();
        // Extract quoted string
        const match = cleanedLine.match(/"([^"]+)"/);
        return match ? match[1] : null;
      })
      .filter((line): line is string => line !== null);

    return cronLines;
  } catch (error) {
    console.error('❌ Failed to read wrangler.toml:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

function extractCronsFromIndex(): string[] {
  const indexPath = resolve(process.cwd(), 'src/index.ts');

  try {
    const indexContent = readFileSync(indexPath, 'utf-8');

    // Extract cron expressions from cronHandlers object
    const handlerMatch = indexContent.match(/const cronHandlers[^{]*\{([\s\S]*?)\};/);
    if (!handlerMatch) {
      console.error('❌ Could not find cronHandlers in src/index.ts');
      return [];
    }

    const cronLines = handlerMatch[1]
      .split('\n')
      .map((line) => {
        // Extract quoted cron expression
        const match = line.match(/'([^']+)':/);
        return match ? match[1] : null;
      })
      .filter((line): line is string => line !== null);

    return cronLines;
  } catch (error) {
    console.error('❌ Failed to read src/index.ts:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

function main() {
  console.log('🔍 Validating cron configuration...\n');

  let hasErrors = false;
  let hasWarnings = false;

  // Extract crons from both files
  const wranglerCrons = extractCronsFromWrangler();
  const indexCrons = extractCronsFromIndex();

  if (wranglerCrons.length === 0) {
    console.error('❌ No cron expressions found in wrangler.toml');
    process.exit(1);
  }

  if (indexCrons.length === 0) {
    console.error('❌ No cron handlers found in src/index.ts');
    process.exit(1);
  }

  console.log('📋 Found cron expressions:');
  console.log('  wrangler.toml:', wranglerCrons.join(', '));
  console.log('  src/index.ts:', indexCrons.join(', '));
  console.log();

  // Validate syntax for wrangler.toml crons
  console.log('✅ Validating syntax:\n');
  for (const cron of wranglerCrons) {
    const result = validateCronSyntax(cron);
    if (!result.valid) {
      console.error(`❌ ${result.error}`);
      hasErrors = true;
    } else {
      console.log(`✅ Valid syntax: ${cron}`);
    }
  }

  // Check for mismatches
  console.log('\n🔗 Checking handler mappings:\n');

  const missing = indexCrons.filter((cron) => !wranglerCrons.includes(cron));
  const unexpected = wranglerCrons.filter((cron) => !indexCrons.includes(cron));

  if (missing.length > 0) {
    console.error('❌ Handler defined but no cron schedule:');
    missing.forEach((cron) => console.error(`   - ${cron}`));
    hasErrors = true;
  }

  if (unexpected.length > 0) {
    console.warn('⚠️  Cron schedule defined but no handler:');
    unexpected.forEach((cron) => console.warn(`   - ${cron}`));
    hasWarnings = true;
  }

  if (missing.length === 0 && unexpected.length === 0) {
    console.log('✅ All cron expressions match their handlers');
  }

  // Validate against expected crons
  console.log('\n📝 Checking against expected configuration:\n');
  const expectedCrons = Object.keys(EXPECTED_CRONS);
  const missingExpected = expectedCrons.filter((expected) => !wranglerCrons.includes(expected));

  if (missingExpected.length > 0) {
    console.error('❌ Missing expected cron schedules:');
    missingExpected.forEach((cron) => {
      console.error(`   - ${cron} (for ${EXPECTED_CRONS[cron as keyof typeof EXPECTED_CRONS]})`);
    });
    hasErrors = true;
  } else {
    console.log('✅ All expected cron schedules present');
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  if (hasErrors) {
    console.error('\n❌ Cron validation FAILED - fix errors before deploying\n');
    process.exit(1);
  } else if (hasWarnings) {
    console.warn('\n⚠️  Cron validation passed with warnings\n');
    process.exit(0);
  } else {
    console.log('\n✅ Cron validation PASSED - all checks successful\n');
    process.exit(0);
  }
}

main();
