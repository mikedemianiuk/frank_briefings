/**
 * Theme Mapping Configuration
 * Maps feed sources to thematic categories for weekly digest
 */

export interface ThemeCategoryConfig {
  name: string;
  feedNames: string[];
}

/**
 * Theme categories for weekly digest
 */
export const THEME_CATEGORIES: ThemeCategoryConfig[] = [
  {
    name: 'Fintech Venture Capital',
    feedNames: [
      'a16z Articles',
      'Sequoia Capital Stories',
      'First Round Review',
      'Index Ventures Perspectives',
      'Lightspeed Venture Partners',
      'Union Square Ventures',
      'Greylock (Greymatter)',
      'Accel Noteworthy',
      'Bessemer Venture Partners',
      'Kleiner Perkins Perspectives',
      'Canapi Ventures Insights',
    ],
  },
  {
    name: 'Airlines/Hotels/eCommerce Loyalty',
    feedNames: [
      'United Airlines IR',
      'Southwest Airlines News',
      'Delta Air Lines News',
      'American Airlines Newsroom',
      'IHG Hotels & Resorts IR',
      'Hyatt Investor Relations',
      'Amazon Blog',
      'Shopify News',
    ],
  },
  {
    name: 'Financial Institutions (JPMC, AmEx, Citi, Capital One)',
    feedNames: [
      'JPMorgan Chase News',
      'American Express News',
      'Citigroup News',
      'Capital One News',
      'Bank of America News',
      'Wells Fargo News',
    ],
  },
  {
    name: 'Payments Industry News',
    feedNames: [
      'Visa News',
      'Mastercard News',
      'PayPal Newsroom',
      'Stripe News',
      'Adyen Blog',
      'Block (Square) News',
      'Marqeta Press Releases',
    ],
  },
  {
    name: 'Startups (Chime, Stripe, Mercury, Sofi, Cardless, Bilt)',
    feedNames: [
      'Chime Blog',
      'Stripe News',
      'Mercury Blog',
      'SoFi News',
      'Cardless News',
      'Bilt Rewards News',
      'Plaid Blog',
      'Affirm Press',
      'Revolut Blog',
      'Wise Blog',
    ],
  },
];

/**
 * Create a map of feed names to theme names for quick lookup
 */
export const FEED_TO_THEME_MAP: Map<string, string> = new Map(
  THEME_CATEGORIES.flatMap(category =>
    category.feedNames.map(feedName => [feedName, category.name])
  )
);

/**
 * Categorize daily summaries by theme
 */
export function categorizeByTheme<T extends { feedName: string }>(
  dailySummaries: T[]
): Record<string, T[]> {
  const themes: Record<string, T[]> = {};

  // Initialize all themes
  for (const category of THEME_CATEGORIES) {
    themes[category.name] = [];
  }

  // Categorize summaries
  for (const summary of dailySummaries) {
    const themeName = FEED_TO_THEME_MAP.get(summary.feedName);
    if (themeName && themes[themeName]) {
      themes[themeName].push(summary);
    } else {
      // Summaries from unmapped feeds go to a catch-all category
      if (!themes['Other']) {
        themes['Other'] = [];
      }
      themes['Other'].push(summary);
    }
  }

  // Remove empty theme categories (except 'Other' if it has items)
  for (const themeName of Object.keys(themes)) {
    if (themes[themeName].length === 0 && themeName !== 'Other') {
      delete themes[themeName];
    }
  }

  return themes;
}

/**
 * Get theme name for a feed
 */
export function getThemeForFeed(feedName: string): string | undefined {
  return FEED_TO_THEME_MAP.get(feedName);
}

/**
 * Get all feed names for a theme
 */
export function getFeedsForTheme(themeName: string): string[] {
  const category = THEME_CATEGORIES.find(c => c.name === themeName);
  return category ? category.feedNames : [];
}
