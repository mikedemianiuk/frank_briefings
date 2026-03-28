import type { IFeedAdapter } from './feed-adapter.js';
import type { ParsedFeedItem } from '../../interfaces.js';
import { WorkersRSSParser } from '../rss-parser-workers.js';
import { FeedError, ErrorCode } from '../../../lib/errors.js';
import { Logger } from '../../../lib/logger.js';

/**
 * RSS feed adapter using rss-parser
 */
export class RssAdapter implements IFeedAdapter {
  private readonly parser: WorkersRSSParser;
  private readonly logger = Logger.forService('RssAdapter');

  constructor() {
    this.parser = new WorkersRSSParser({
      timeout: 30000,
      headers: {
        'User-Agent': 'Briefings/1.0 (+https://github.com/yourusername/briefings)',
      },
    });
  }

  async fetchArticles(url: string): Promise<ParsedFeedItem[]> {
    try {
      this.logger.debug('Fetching RSS feed', { url });

      const feed = await this.parser.parseURL(url);

      if (!feed.items || feed.items.length === 0) {
        this.logger.warn('No items found in feed', { url });
        return [];
      }

      const parsedItems: ParsedFeedItem[] = feed.items.map((item) => {
        const parsed: ParsedFeedItem = {
          title: item.title || 'Untitled',
          link: item.link || item.guid || '',
        };

        if (item.content) parsed.content = item.content;
        if (item.contentSnippet) parsed.contentSnippet = item.contentSnippet;
        if (item.creator) parsed.creator = item.creator;
        if (item.isoDate) parsed.isoDate = item.isoDate;
        if (item.pubDate) parsed.pubDate = item.pubDate;

        return parsed;
      });

      this.logger.info('Successfully fetched RSS feed', {
        url,
        itemCount: parsedItems.length,
      });

      return parsedItems;
    } catch (error) {
      this.logger.error('Failed to fetch RSS feed', error as Error, { url });

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new FeedError(`Failed to parse RSS feed: ${errorMessage}`, ErrorCode.FEED_PARSE_ERROR, {
        service: 'rss-adapter',
        operation: 'fetchArticles',
        metadata: { url, originalError: errorMessage },
      });
    }
  }
}
