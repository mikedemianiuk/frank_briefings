import type { IFeedAdapter } from './feed-adapter.js';
import type { ParsedFeedItem } from '../../interfaces.js';
import { FeedError, ErrorCode } from '../../../lib/errors.js';
import { Logger } from '../../../lib/logger.js';

/**
 * Browser rendering adapter using Cloudflare Browser Rendering REST API
 * Fetches content from JavaScript-heavy websites by executing JS and waiting for DOM
 *
 * IMPORTANT: This adapter requires:
 * 1. Cloudflare Workers Paid plan ($5/month)
 * 2. Browser Rendering API token (BROWSER_API_TOKEN secret)
 * 3. Account ID configured in wrangler.toml
 *
 * Cost: ~$5/month base + minimal per-request costs
 * Recommended usage: Dedicated cron job, run once weekly for premium targets
 */
export class BrowserAdapter implements IFeedAdapter {
  private readonly logger = Logger.forService('BrowserAdapter');
  private readonly accountId: string;
  private readonly apiToken: string;

  constructor(accountId: string, apiToken: string) {
    this.accountId = accountId;
    this.apiToken = apiToken;
  }

  async fetchArticles(url: string, selector?: string | null): Promise<ParsedFeedItem[]> {
    if (!selector) {
      throw new FeedError('Selector is required for browser adapter', ErrorCode.FEED_PARSE_ERROR, {
        service: 'browser-adapter',
        operation: 'fetchArticles',
        metadata: { url },
      });
    }

    try {
      this.logger.info('Scraping with Browser Rendering REST API', { url, selector });

      // Call Cloudflare Browser Rendering REST API
      const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/browser-rendering/scrape`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          elements: [
            {
              selector,
            },
          ],
          gotoOptions: {
            waitUntil: 'networkidle0', // Wait for JavaScript to finish
          },
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Browser Rendering API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as {
        results: Array<{
          selector: string;
          results: Array<{
            text: string;
            html: string;
            attributes: Array<{ name: string; value: string }>;
          }>;
        }>;
      };

      // Extract articles from API response
      const parsedItems: ParsedFeedItem[] = [];
      const now = new Date().toISOString();

      if (data.results && data.results.length > 0) {
        const selectorResults = data.results[0].results || [];

        for (const element of selectorResults) {
          const title = element.text?.trim() || '';
          if (!title) continue;

          // Try to find link from href attribute
          let link = '';
          const hrefAttr = element.attributes?.find((attr) => attr.name === 'href');
          if (hrefAttr) {
            link = hrefAttr.value;
          } else {
            // Try to extract link from HTML
            const hrefMatch = element.html?.match(/href=["']([^"']+)["']/);
            if (hrefMatch) {
              link = hrefMatch[1];
            }
          }

          // Make relative URLs absolute
          if (link && !link.startsWith('http')) {
            try {
              link = new URL(link, url).toString();
            } catch {
              // Keep original if URL parsing fails
            }
          }

          // Use base URL if no link found
          if (!link) {
            link = url;
          }

          parsedItems.push({
            title,
            link,
            content: title,
            contentSnippet: title.substring(0, 200),
            pubDate: now,
            isoDate: now,
          });
        }
      }

      this.logger.info('Successfully scraped with Browser Rendering REST API', {
        url,
        selector,
        itemCount: parsedItems.length,
      });

      return parsedItems;
    } catch (error) {
      this.logger.error('Browser scraping failed', error as Error, { url, selector });

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new FeedError(`Browser scraping failed: ${errorMessage}`, ErrorCode.FEED_PARSE_ERROR, {
        service: 'browser-adapter',
        operation: 'fetchArticles',
        metadata: { url, selector, originalError: errorMessage },
      });
    }
  }
}
