import type { ParsedFeedItem } from '../../interfaces.js';

/**
 * Interface for feed adapters
 * Allows different strategies for fetching articles (RSS, scraping, etc.)
 */
export interface IFeedAdapter {
  /**
   * Fetch articles from the given URL
   * @param url - The URL to fetch from
   * @param selector - Optional CSS selector for scraping
   * @returns Array of parsed feed items
   */
  fetchArticles(url: string, selector?: string | null): Promise<ParsedFeedItem[]>;
}
