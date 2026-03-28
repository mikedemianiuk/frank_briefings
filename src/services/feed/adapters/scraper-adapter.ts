import * as cheerio from 'cheerio';
import type { IFeedAdapter } from './feed-adapter.js';
import type { ParsedFeedItem } from '../../interfaces.js';
import { FeedError, ErrorCode } from '../../../lib/errors.js';
import { Logger } from '../../../lib/logger.js';

/**
 * Web scraping adapter using cheerio
 * Extracts content from HTML pages using CSS selectors
 */
export class ScraperAdapter implements IFeedAdapter {
  private readonly logger = Logger.forService('ScraperAdapter');

  async fetchArticles(url: string, selector?: string | null): Promise<ParsedFeedItem[]> {
    if (!selector) {
      throw new FeedError('Selector is required for scraper adapter', ErrorCode.FEED_PARSE_ERROR, {
        service: 'scraper-adapter',
        operation: 'fetchArticles',
        metadata: { url },
      });
    }

    try {
      this.logger.debug('Scraping webpage', { url, selector });

      // Fetch HTML
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Briefings/1.0 (+https://github.com/yourusername/briefings)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();

      // Parse HTML with cheerio
      const $ = cheerio.load(html);

      // Find all elements matching the selector
      const elements = $(selector);

      if (elements.length === 0) {
        this.logger.warn('No elements found with selector', { url, selector });
        return [];
      }

      // Extract items
      const items: ParsedFeedItem[] = [];
      elements.each((index, element) => {
        const $el = $(element);

        // Try to get a link - check if element is a link or has a link child
        let link = '';
        if ($el.is('a')) {
          link = $el.attr('href') || '';
        } else {
          const $link = $el.find('a').first();
          if ($link.length > 0) {
            link = $link.attr('href') || '';
          }
        }

        // Make relative URLs absolute
        if (link && !link.startsWith('http')) {
          try {
            const baseUrl = new URL(url);
            link = new URL(link, baseUrl.origin).toString();
          } catch {
            // If URL parsing fails, keep the original link
          }
        }

        // Get text content
        const title = $el.text().trim();

        if (title) {
          items.push({
            title,
            link: link || url, // Use base URL if no link found
            content: title,
            contentSnippet: title.substring(0, 200),
            pubDate: new Date().toISOString(),
            isoDate: new Date().toISOString(),
          });
        }
      });

      this.logger.info('Successfully scraped webpage', {
        url,
        selector,
        itemCount: items.length,
      });

      return items;
    } catch (error) {
      this.logger.error('Failed to scrape webpage', error as Error, { url, selector });

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new FeedError(`Failed to scrape webpage: ${errorMessage}`, ErrorCode.FEED_PARSE_ERROR, {
        service: 'scraper-adapter',
        operation: 'fetchArticles',
        metadata: { url, selector, originalError: errorMessage },
      });
    }
  }
}
