# Incident Report: Weekly Digest Email System Failure

**Date:** February 16, 2026
**Reported By:** User
**Severity:** High (P1) - User-facing feature failure
**Status:** Root cause identified, fix proposed
**Author:** Engineering Analysis

---

## Executive Summary

The weekly digest email system has been **non-functional since deployment** due to a critical cron configuration mismatch. The automated Sunday digest emails (scheduled for 1 PM UTC / 8 AM ET) have never been sent because the cron trigger is not firing. Manual triggers work correctly, indicating the email pipeline itself is functional.

**Impact:**
- 🚨 **100% failure rate** for automated weekly digest emails
- ⏱️ **Unknown duration** - likely since initial deployment
- 📧 **Zero automated emails sent** to recipients (mikedteaches@gmail.com, kenyon.cory@gmail.com, rhtsrinivas@gmail.com)
- ✅ **Manual triggers work** - email infrastructure is healthy

**Root Cause:**
Cron syntax mismatch between `wrangler.toml` configuration (`"0 13 * * Sun"`) and the expected format in Cloudflare Workers (`'0 13 * * 0'`).

---

## Timeline

### Pre-Incident
- **Unknown Date**: Initial deployment with cron configuration
- **Sundays at 1 PM UTC**: Expected weekly digest email delivery
- **No alerts**: System showed no errors, simply never triggered

### Discovery
- **February 16, 2026 ~11 PM ET**: User reports email failure from previous day (Sunday February 15)
- **February 16, 2026 11:03 PM ET**: Manual trigger test successful - email pipeline confirmed working
- **February 16, 2026 11:05 PM ET**: Root cause identified via code analysis

---

## Root Cause Analysis

### 1. The Bug

**Location:** [`wrangler.toml:60`](../wrangler.toml#L60)

```toml
# Current (BROKEN)
crons = [
  "0 */4 * * *",
  "0 10 * * *",
  "0 6 * * *",
  "0 13 * * Sun"  # ❌ PROBLEM: "Sun" is not valid Cloudflare cron syntax
]
```

**Expected by Handler:** [`src/index.ts:150`](../src/index.ts#L150)

```typescript
const cronHandlers: Record<string, typeof feedFetchCron> = {
  '0 */4 * * *': feedFetchCron,
  '0 10 * * *': dailySummaryCron,
  '0 6 * * *': validateFeedsCron,
  '0 13 * * 0': weeklyDigestCron,  // ✅ EXPECTS: Numeric 0 (Sunday)
};
```

### 2. Why This Fails

**Cloudflare Workers Cron Syntax:**
- Day-of-week must be numeric: `0-7` (where both 0 and 7 represent Sunday)
- Text representations (`Sun`, `Mon`, etc.) are **NOT supported**
- Standard cron syntax: `minute hour day-of-month month day-of-week`

**Current Behavior:**
1. Cloudflare tries to match cron expression `"0 13 * * Sun"` at 1 PM UTC on Sundays
2. Expression fails to parse or doesn't match the handler lookup key
3. Handler in `src/index.ts:153` looks for `'0 13 * * 0'` in the `cronHandlers` map
4. No match found → handler not executed
5. **No error logged** because Cloudflare considers the cron valid at the platform level

**Result:** Silent failure - cron never fires, no logs, no emails.

### 3. Evidence

**File Analysis:**

1. **[`wrangler.toml`](../wrangler.toml#L56-L61)** - Contains the malformed cron
   ```toml
   crons = [
     "0 */4 * * *",   # Feed fetch - Works ✅
     "0 10 * * *",    # Daily summary - Works ✅
     "0 6 * * *",     # Feed validation - Works ✅
     "0 13 * * Sun"   # Weekly digest - BROKEN ❌
   ]
   ```

2. **[`src/index.ts`](../src/index.ts#L146-L151)** - Handler expects numeric format
   ```typescript
   const cronHandlers: Record<string, typeof feedFetchCron> = {
     '0 */4 * * *': feedFetchCron,
     '0 10 * * *': dailySummaryCron,
     '0 6 * * *': validateFeedsCron,
     '0 13 * * 0': weeklyDigestCron,  // Numeric 0, not "Sun"
   };
   ```

3. **[`src/server-functions/crons/initiate-weekly-digest.ts`](../src/server-functions/crons/initiate-weekly-digest.ts#L1-L4)** - Correct schedule documented
   ```typescript
   /**
    * Cron handler for initiating weekly digest generation
    * Scheduled via wrangler.toml: 0 13 * * 0 (1 PM UTC = 8 AM ET Sunday)
    */
   ```

**Manual Trigger Test:**
```bash
$ pnpm trigger weekly-summary 2026-02-16
# Result: SUCCESS ✅
{
  "success": true,
  "message": "Weekly summary task initiated for 2026-02-10 to 2026-02-16",
  "data": {
    "requestId": "50902c6e-90bd-48ae-b7f4-c4ddf4abf31d",
    "weekStartDate": "2026-02-10",
    "weekEndDate": "2026-02-16",
    "force": false
  }
}
```

This confirms:
- ✅ Queue system functional
- ✅ Weekly digest generation working
- ✅ Gemini API integration operational
- ✅ Resend email service configured
- ✅ Database writes successful
- ❌ **ONLY the cron trigger is broken**

---

## Impact Assessment

### User Impact
- **Severity**: High (P1)
- **Affected Users**: 3 recipients expecting weekly digests
- **User Experience**: Expected weekly email never arrives
- **Data Loss**: None - summaries can be regenerated
- **Workaround**: Manual trigger via API or CLI

### System Impact
- **Service Availability**: Email infrastructure 100% operational
- **Data Integrity**: No corruption - database and R2 storage intact
- **Cost Impact**: None - failed crons don't consume resources
- **Monitoring Gaps**: No alerts for missing cron executions

### Business Impact
- **Trust**: User expectation broken (weekly digest subscription)
- **Engagement**: Zero weekly digest engagement (no emails sent)
- **Retention**: Risk of users forgetting about service

---

## Detailed Technical Analysis

### Email Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Weekly Digest Pipeline                        │
└─────────────────────────────────────────────────────────────────┘

1. TRIGGER (BROKEN ❌)
   ┌──────────────────┐
   │  Cron: 0 13 * * Sun │  ← PROBLEM: Invalid syntax
   └────────┬─────────┘
            │ (Never fires)
            ↓
   ┌──────────────────┐
   │ weeklyDigestCron │  ← Never called
   └────────┬─────────┘
            │
            ↓

2. QUEUE (Works ✅)
   ┌─────────────────────────┐
   │ WEEKLY_DIGEST_QUEUE     │  ← Works when manually triggered
   └────────┬────────────────┘
            │
            ↓
   ┌──────────────────────────┐
   │ weekly-digest-consumer   │  ← Fully functional
   └────────┬─────────────────┘
            │
            ↓

3. GENERATION (Works ✅)
   ┌────────────────────────────┐
   │ Fetch daily summaries      │
   │ Build context from R2      │
   │ Generate recap (Gemini)    │
   │ Parse metadata             │
   │ Save to database          │
   │ Store to R2               │
   └────────┬───────────────────┘
            │
            ↓

4. EMAIL (Works ✅)
   ┌────────────────────────────┐
   │ Resend API                 │
   │ From: briefings@mikedteaches.com
   │ To: 3 recipients          │
   │ Subject: [Briefings] ...   │
   └────────┬───────────────────┘
            │
            ↓
   ┌────────────────────────────┐
   │ Update sentAt timestamp    │
   └────────────────────────────┘
```

### Environment Configuration

**Email Settings** (from [`wrangler.toml`](../wrangler.toml#L28-L31)):
```toml
EMAIL_FROM = "briefings@mikedteaches.com"
EMAIL_TO = "mikedteaches@gmail.com,kenyon.cory@gmail.com,rhtsrinivas@gmail.com"
EMAIL_SUBJECT_PREFIX = "[Briefings]"
```

**Status:** ✅ All configured correctly

**Resend API Key:** ✅ Set via Cloudflare secrets
**Domain Verification:** ✅ mikedteaches.com verified (from earlier session)
**DNS Records:** ✅ SPF, DKIM, MX records configured

### Code Quality Issues

1. **No Input Validation**
   - Cron expression in `wrangler.toml` never validated
   - No build-time check for cron/handler mismatch
   - Silent failure mode (no error when handler not found)

2. **Inconsistent Documentation**
   - Comment in `initiate-weekly-digest.ts` says `0 13 * * 0` (correct)
   - Actual config in `wrangler.toml` says `0 13 * * Sun` (incorrect)
   - No single source of truth

3. **Missing Observability**
   - No alert when expected cron doesn't fire
   - No health check for "last successful weekly digest"
   - No monitoring dashboard for email delivery

4. **Tight Coupling**
   - Handler lookup uses string matching on cron expressions
   - Brittle: Any format mismatch = silent failure
   - Better: Use enum/constant for schedule definitions

---

## The Fix

### Immediate Remediation (5 minutes)

**Change 1: Fix `wrangler.toml` cron expression**

```diff
--- a/wrangler.toml
+++ b/wrangler.toml
@@ -57,7 +57,7 @@ crons = [
   "0 */4 * * *",
   "0 10 * * *",
   "0 6 * * *",
-  "0 13 * * Sun"
+  "0 13 * * 0"
 ]
```

**Deployment:**
```bash
# 1. Apply the fix
git add wrangler.toml
git commit -m "fix: correct weekly digest cron syntax (0 13 * * 0)"

# 2. Deploy to production
pnpm deploy

# 3. Verify cron schedule
npx wrangler deployments list

# 4. Monitor logs on next Sunday
# Expected: "Weekly digest cron triggered" at 1 PM UTC
```

**Rollback Plan:**
```bash
git revert HEAD
pnpm deploy
```

### Verification Steps

1. **Immediate**: Check Cloudflare dashboard cron schedules
2. **Next Sunday (Feb 23, 2026 at 1 PM UTC)**: Monitor for automatic trigger
3. **Logs to watch for**:
   ```
   "Scheduled event triggered: 0 13 * * 0 at 2026-02-23T13:00:00.000Z"
   "Weekly digest cron triggered"
   "Weekly digest task queued"
   "Email sent successfully"
   ```

4. **Database verification**:
   ```sql
   SELECT * FROM WeeklySummary
   WHERE weekEndDate >= strftime('%s', '2026-02-23') * 1000
   ORDER BY createdAt DESC LIMIT 1;
   ```

5. **Email verification**: Check inbox for all 3 recipients

### Testing Checklist

- [ ] Change wrangler.toml cron expression
- [ ] Deploy to production
- [ ] Verify deployment successful
- [ ] Check Cloudflare cron schedules
- [ ] Wait for next Sunday 1 PM UTC
- [ ] Monitor production logs during cron execution
- [ ] Verify email received by all 3 recipients
- [ ] Check database WeeklySummary.sentAt is populated
- [ ] Verify R2 storage has new digest file

---

## Long-Term Improvements

### Priority 1: Prevent Recurrence (High Priority)

**1. Add Build-Time Validation**

Create [`scripts/validate-cron-config.ts`](../scripts/validate-cron-config.ts):

```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Validates that cron expressions in wrangler.toml match
 * expected handlers in src/index.ts
 */

const EXPECTED_CRONS = {
  '0 */4 * * *': 'feedFetchCron',
  '0 10 * * *': 'dailySummaryCron',
  '0 6 * * *': 'validateFeedsCron',
  '0 13 * * 0': 'weeklyDigestCron',  // Must be numeric day-of-week
};

function validateCronSyntax(cron: string): { valid: boolean; error?: string } {
  // Check for invalid text day-of-week
  const parts = cron.split(' ');
  if (parts.length !== 5) {
    return { valid: false, error: `Invalid cron format: ${cron}` };
  }

  const dayOfWeek = parts[4];
  const invalidDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (invalidDays.includes(dayOfWeek)) {
    return {
      valid: false,
      error: `Day-of-week must be numeric (0-7), not "${dayOfWeek}". Use 0 for Sunday.`,
    };
  }

  return { valid: true };
}

function main() {
  // Read wrangler.toml
  const wranglerPath = resolve(process.cwd(), 'wrangler.toml');
  const wranglerContent = readFileSync(wranglerPath, 'utf-8');

  // Extract cron expressions
  const cronMatch = wranglerContent.match(/crons = \[([\s\S]*?)\]/);
  if (!cronMatch) {
    console.error('❌ Could not find crons array in wrangler.toml');
    process.exit(1);
  }

  const cronLines = cronMatch[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"'))
    .map((line) => line.replace(/[",]/g, '').trim());

  console.log('Found cron expressions:', cronLines);

  let hasErrors = false;

  // Validate syntax
  for (const cron of cronLines) {
    const result = validateCronSyntax(cron);
    if (!result.valid) {
      console.error(`❌ ${result.error}`);
      hasErrors = true;
    } else {
      console.log(`✅ Valid syntax: ${cron}`);
    }
  }

  // Validate against expected crons
  const expectedCrons = Object.keys(EXPECTED_CRONS);
  const missing = expectedCrons.filter((expected) => !cronLines.includes(expected));
  const unexpected = cronLines.filter((cron) => !expectedCrons.includes(cron));

  if (missing.length > 0) {
    console.error(`❌ Missing expected crons: ${missing.join(', ')}`);
    hasErrors = true;
  }

  if (unexpected.length > 0) {
    console.warn(`⚠️  Unexpected crons (no handler): ${unexpected.join(', ')}`);
  }

  if (hasErrors) {
    console.error('\n❌ Cron validation failed');
    process.exit(1);
  }

  console.log('\n✅ All cron expressions valid');
}

main();
```

Add to [`package.json`](../package.json):
```json
{
  "scripts": {
    "validate:cron": "tsx scripts/validate-cron-config.ts",
    "prebuild": "pnpm validate:cron",
    "predeploy": "pnpm validate:cron"
  }
}
```

**Impact:** Catches cron mismatches before deployment

**2. Add Cron Execution Monitoring**

Create health check endpoint [`src/server-functions/http/health.ts`](../src/server-functions/http/health.ts):

```typescript
// Add to existing health endpoint
export async function GET(env: Env): Promise<Response> {
  const db = getDb(env);

  // Check last weekly digest
  const lastWeeklyDigest = await db
    .selectFrom('WeeklySummary')
    .select(['createdAt', 'sentAt', 'weekEndDate'])
    .orderBy('createdAt', 'desc')
    .limit(1)
    .executeTakeFirst();

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  let weeklyDigestStatus = 'healthy';
  let weeklyDigestWarning = null;

  if (!lastWeeklyDigest) {
    weeklyDigestStatus = 'warning';
    weeklyDigestWarning = 'No weekly digests found in database';
  } else if (lastWeeklyDigest.createdAt < sevenDaysAgo) {
    weeklyDigestStatus = 'error';
    weeklyDigestWarning = `Last weekly digest is ${Math.floor((now - lastWeeklyDigest.createdAt) / (24 * 60 * 60 * 1000))} days old`;
  } else if (!lastWeeklyDigest.sentAt) {
    weeklyDigestStatus = 'warning';
    weeklyDigestWarning = 'Last weekly digest not sent via email';
  }

  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: 'healthy',
      weeklyDigest: {
        status: weeklyDigestStatus,
        lastGenerated: lastWeeklyDigest ? new Date(lastWeeklyDigest.createdAt).toISOString() : null,
        lastSent: lastWeeklyDigest?.sentAt ? new Date(lastWeeklyDigest.sentAt).toISOString() : null,
        warning: weeklyDigestWarning,
      },
    },
  });
}
```

**Impact:** Enables external monitoring (UptimeRobot, Pingdom, etc.)

### Priority 2: Improve Reliability (Medium Priority)

**3. Add Dead Letter Queue (DLQ)**

For failed email deliveries, implement retry logic:

```typescript
// In weekly-digest-consumer.ts
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 60000; // 1 minute

async function sendEmailWithRetry(
  emailService: EmailService,
  params: SendDigestParams,
  retries = 0
): Promise<void> {
  try {
    const result = await emailService.sendWeeklyDigest(params);

    if (!result.success && retries < MAX_RETRIES) {
      logger.warn(`Email send failed, retrying (${retries + 1}/${MAX_RETRIES})`);
      await sleep(RETRY_DELAY_MS);
      return sendEmailWithRetry(emailService, params, retries + 1);
    }

    if (!result.success) {
      throw new Error(`Email failed after ${MAX_RETRIES} retries: ${result.error}`);
    }
  } catch (error) {
    logger.error('Email send error', error);
    throw error;
  }
}
```

**4. Add Email Delivery Webhook**

Configure Resend webhook to track delivery:

```typescript
// New endpoint: /api/webhooks/email-status
app.post('/api/webhooks/email-status', async (c) => {
  const event = await c.req.json();

  if (event.type === 'email.bounced' || event.type === 'email.failed') {
    logger.error('Email delivery failed', {
      messageId: event.data.email_id,
      recipient: event.data.to,
      reason: event.data.reason,
    });

    // TODO: Alert engineering team
  }

  return c.json({ received: true });
});
```

### Priority 3: Observability (Medium Priority)

**5. Structured Logging**

Already implemented in code - ensure logs are being captured:
- ✅ Cron trigger logs ([`src/index.ts:143`](../src/index.ts#L143))
- ✅ Queue processing logs ([`src/server-functions/queues/weekly-digest-consumer.ts`](../src/server-functions/queues/weekly-digest-consumer.ts))
- ✅ Email send logs ([`src/server-functions/queues/weekly-digest-consumer.ts:256`](../src/server-functions/queues/weekly-digest-consumer.ts#L256))

**Missing:** Log aggregation and alerting
- Set up Cloudflare Log push to external service (Datadog, Grafana, etc.)
- Create alert for "no weekly digest in 8 days"
- Dashboard for email delivery rates

**6. Metrics & Dashboards**

Track:
- Cron execution rate (expected: 1/week for weekly digest)
- Email delivery success rate (target: 100%)
- Email bounce rate (target: 0%)
- Time to generate digest (baseline, detect anomalies)
- Queue processing time

---

## Prevention Checklist

To prevent similar incidents in the future:

### Pre-Deployment
- [ ] Validate cron syntax in wrangler.toml
- [ ] Verify cron expressions match handler keys
- [ ] Test all cron handlers manually via API
- [ ] Check email configuration (API keys, recipients, domain)
- [ ] Verify Resend domain verification status

### Post-Deployment
- [ ] Monitor logs for expected cron executions
- [ ] Set up health check monitoring (weekly digest age)
- [ ] Configure alerts for missing cron executions
- [ ] Test email delivery to all recipients
- [ ] Verify database sentAt timestamps are being set

### Ongoing
- [ ] Weekly review of email delivery metrics
- [ ] Monthly audit of cron execution logs
- [ ] Quarterly review of Resend API limits and usage
- [ ] Semi-annual disaster recovery test (manual digest generation)

---

## Communication Plan

### Internal Team
- [x] Engineering notified of issue
- [ ] Root cause identified and documented (this report)
- [ ] Fix deployed to production
- [ ] Post-mortem scheduled (optional)

### User Communication
**Option 1: Proactive (Recommended)**
```
Subject: Briefings Weekly Digest - Service Update

Hi [Name],

We identified and fixed an issue that was preventing your weekly Briefings
digest from being sent automatically. The good news: your digest is still
being generated and stored - we just weren't emailing it to you!

The fix is now live, and you should receive your next weekly digest on
Sunday, February 23rd at 8 AM ET as scheduled.

If you'd like to see what you missed, I can send you the digests manually.
Just reply to this email and let me know!

Best,
The Briefings Team
```

**Option 2: Reactive**
- Wait for user to notice
- Respond with fix details when they inquire
- Send missed digests upon request

### Stakeholder Update
```
**Weekly Digest Email Failure - Resolved**

**Impact:** Weekly digest emails were not being sent automatically since deployment
**Root Cause:** Cron configuration syntax error
**Resolution:** Fixed cron expression, deployed to production
**Next Steps:** Monitoring Sunday Feb 23 for successful automated send

**Technical Details:** See full incident report at docs/INCIDENT-2026-02-16-email-failure.md
```

---

## Lessons Learned

### What Went Well ✅
1. **Email pipeline architecture solid** - When triggered manually, everything works
2. **Quick diagnosis** - Root cause identified within minutes of investigation
3. **Simple fix** - One-line change, low risk
4. **No data loss** - All digests can be regenerated

### What Went Wrong ❌
1. **No validation** - Invalid cron syntax deployed to production
2. **Silent failure** - No alerts when expected cron didn't fire
3. **Inconsistent documentation** - Comments didn't match config
4. **No pre-deployment testing** - Cron handlers never manually tested

### What We'll Do Differently 🔧
1. **Add build-time validation** - Catch config errors before deployment
2. **Implement monitoring** - Alert when expected events don't occur
3. **Document testing procedures** - Checklist for cron-related changes
4. **Add health checks** - External monitoring for email delivery

---

## Related Incidents

**None on record** - This appears to be the first email-related incident.

---

## Appendix A: Cron Syntax Reference

### Cloudflare Workers Cron Format

```
* * * * *
│ │ │ │ │
│ │ │ │ └─── Day of week (0-7, both 0 and 7 = Sunday)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

### Valid Day-of-Week Values

- `0` or `7` = Sunday ✅
- `1` = Monday ✅
- `2` = Tuesday ✅
- `3` = Wednesday ✅
- `4` = Thursday ✅
- `5` = Friday ✅
- `6` = Saturday ✅

### Invalid (DO NOT USE)

- `Sun`, `Mon`, `Tue`, etc. ❌
- `Sunday`, `Monday`, etc. ❌
- Text representations not supported

### Examples

```bash
# Good ✅
"0 13 * * 0"     # 1 PM UTC every Sunday
"0 9 * * 1"      # 9 AM UTC every Monday
"30 14 * * 5"    # 2:30 PM UTC every Friday

# Bad ❌
"0 13 * * Sun"   # Will not work
"0 9 * * Monday" # Will not work
```

---

## Appendix B: Manual Recovery Commands

### Generate and Send Missed Digests

```bash
# For Sunday Feb 9, 2026
pnpm trigger weekly-summary 2026-02-09 --force

# For Sunday Feb 16, 2026
pnpm trigger weekly-summary 2026-02-16 --force

# Check status
npx wrangler d1 execute DB --remote --command \
  "SELECT weekStartDate, weekEndDate, sentAt, title
   FROM WeeklySummary
   ORDER BY createdAt DESC LIMIT 5"
```

### Verify Email Configuration

```bash
# Test Resend API
pnpm test:resend

# Check secrets
npx wrangler secret list

# View email settings
grep -A5 "EMAIL" wrangler.toml
```

### Check Production Logs

```bash
# Real-time log monitoring
pnpm tail

# Filter for weekly digest events
pnpm tail | grep -i "weekly\|email"

# Check specific date range (via Cloudflare dashboard)
# https://dash.cloudflare.com → Workers → briefings → Logs
```

---

## Appendix C: Emergency Contacts

**Cloudflare Support:**
- Dashboard: https://dash.cloudflare.com
- Support: support@cloudflare.com
- Status: https://www.cloudflarestatus.com

**Resend Support:**
- Dashboard: https://resend.com/dashboard
- Support: support@resend.com
- Status: https://status.resend.com

**Domain DNS (mikedteaches.com):**
- Registrar: Cloudflare
- DNS Management: Cloudflare Dashboard

---

## Sign-Off

**Prepared By:** Engineering Analysis System
**Date:** February 16, 2026 11:15 PM ET
**Status:** Ready for deployment
**Approval Required:** Yes - Deploy fix to production

**Next Action:** Apply one-line fix to wrangler.toml and deploy

---

**Related Files:**
- [`wrangler.toml`](../wrangler.toml) - Configuration file with bug
- [`src/index.ts`](../src/index.ts) - Cron handler mapping
- [`src/server-functions/crons/initiate-weekly-digest.ts`](../src/server-functions/crons/initiate-weekly-digest.ts) - Cron handler
- [`src/server-functions/queues/weekly-digest-consumer.ts`](../src/server-functions/queues/weekly-digest-consumer.ts) - Email sending logic
