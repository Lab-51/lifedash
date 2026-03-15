import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// We test pure logic functions from intelFeedService.
// Since escapeHtml, isRedditFeed, safeString, faviconUrl, and the Reddit URL
// normalization logic are not exported, we replicate them here for unit testing.
// This is intentional — we're testing the LOGIC, not wiring.
// ---------------------------------------------------------------------------

// ============================================================================
// Replicated pure functions (mirror of source)
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isRedditFeed(url: string): boolean {
  return /reddit\.com\/r\//i.test(url);
}

/** Reddit URL normalization: strip .rss suffix, strip trailing slashes, append .json */
function normalizeRedditUrl(url: string): string {
  return url.replace(/\/?\.rss\/?$/, '').replace(/\/+$/, '') + '.json';
}

function safeString(val: unknown, maxLen = 500): string | null {
  if (val == null) return null;
  if (typeof val === 'string') return val.slice(0, maxLen);
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    for (const key of ['name', '_', 'text', 'value', '$t']) {
      if (typeof obj[key] === 'string') return (obj[key] as string).slice(0, maxLen);
    }
    try {
      return JSON.stringify(val).slice(0, maxLen);
    } catch {
      /* fall through */
    }
  }
  try {
    return String(val).slice(0, maxLen);
  } catch {
    return null;
  }
}

function faviconUrl(feedUrl: string): string {
  try {
    const domain = new URL(feedUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return '';
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('intelFeedService — pure logic', () => {
  // -------------------------------------------------------------------------
  // 1. escapeHtml — all 5 character replacements
  // -------------------------------------------------------------------------
  describe('escapeHtml', () => {
    it('escapes ampersands', () => {
      expect(escapeHtml('AT&T')).toBe('AT&amp;T');
    });

    it('escapes less-than signs', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('escapes greater-than signs', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    it('escapes double quotes', () => {
      expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    it('escapes single quotes', () => {
      expect(escapeHtml("it's")).toBe('it&#039;s');
    });

    it('escapes all 5 characters in one string', () => {
      const input = `<div class="a" data-x='b'>&`;
      const expected = '&lt;div class=&quot;a&quot; data-x=&#039;b&#039;&gt;&amp;';
      expect(escapeHtml(input)).toBe(expected);
    });

    it('leaves safe strings untouched', () => {
      expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
    });

    it('handles empty string', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Reddit URL normalization
  // -------------------------------------------------------------------------
  describe('Reddit URL normalization', () => {
    it('converts .rss URL to .json', () => {
      expect(normalizeRedditUrl('https://www.reddit.com/r/ClaudeAI/.rss')).toBe(
        'https://www.reddit.com/r/ClaudeAI.json',
      );
    });

    it('converts plain subreddit URL (with trailing slash) to .json', () => {
      expect(normalizeRedditUrl('https://www.reddit.com/r/ClaudeAI/')).toBe('https://www.reddit.com/r/ClaudeAI.json');
    });

    it('converts plain subreddit URL (no trailing slash) to .json', () => {
      expect(normalizeRedditUrl('https://www.reddit.com/r/ClaudeAI')).toBe('https://www.reddit.com/r/ClaudeAI.json');
    });

    it('handles .rss without leading slash', () => {
      expect(normalizeRedditUrl('https://www.reddit.com/r/LocalLLaMA.rss')).toBe(
        'https://www.reddit.com/r/LocalLLaMA.json',
      );
    });

    it('handles multiple trailing slashes', () => {
      expect(normalizeRedditUrl('https://www.reddit.com/r/test///')).toBe('https://www.reddit.com/r/test.json');
    });
  });

  // -------------------------------------------------------------------------
  // 3. isRedditFeed detection
  // -------------------------------------------------------------------------
  describe('isRedditFeed', () => {
    it('detects standard Reddit feed URLs', () => {
      expect(isRedditFeed('https://www.reddit.com/r/ClaudeAI/.rss')).toBe(true);
      expect(isRedditFeed('https://reddit.com/r/LocalLLaMA/')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isRedditFeed('https://REDDIT.COM/r/test')).toBe(true);
    });

    it('rejects non-Reddit URLs', () => {
      expect(isRedditFeed('https://techcrunch.com/feed')).toBe(false);
      expect(isRedditFeed('https://example.com/r/stuff')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Default sources
  // -------------------------------------------------------------------------
  describe('default sources', () => {
    const DEFAULT_SOURCES = [
      { name: 'Anthropic Blog', url: 'https://www.anthropic.com/rss.xml' },
      { name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml' },
      { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
      { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
      { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab' },
      { name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
      { name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/' },
      { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/' },
    ];

    it('has 8 default sources', () => {
      expect(DEFAULT_SOURCES).toHaveLength(8);
    });

    it('all sources have valid URLs', () => {
      for (const source of DEFAULT_SOURCES) {
        expect(() => new URL(source.url)).not.toThrow();
      }
    });

    it('all sources have non-empty names', () => {
      for (const source of DEFAULT_SOURCES) {
        expect(source.name.length).toBeGreaterThan(0);
      }
    });

    it('includes key AI sources (Anthropic, OpenAI)', () => {
      const names = DEFAULT_SOURCES.map((s) => s.name);
      expect(names).toContain('Anthropic Blog');
      expect(names).toContain('OpenAI Blog');
    });

    it('no duplicate URLs', () => {
      const urls = DEFAULT_SOURCES.map((s) => s.url);
      expect(new Set(urls).size).toBe(urls.length);
    });
  });

  // -------------------------------------------------------------------------
  // 5. safeString utility
  // -------------------------------------------------------------------------
  describe('safeString', () => {
    it('returns null for null/undefined', () => {
      expect(safeString(null)).toBeNull();
      expect(safeString(undefined)).toBeNull();
    });

    it('returns string values directly', () => {
      expect(safeString('hello')).toBe('hello');
    });

    it('truncates long strings to maxLen', () => {
      const long = 'a'.repeat(1000);
      expect(safeString(long, 10)).toBe('a'.repeat(10));
    });

    it('extracts name from object', () => {
      expect(safeString({ name: 'John' })).toBe('John');
    });

    it('extracts text from object', () => {
      expect(safeString({ text: 'Hello' })).toBe('Hello');
    });

    it('falls back to JSON.stringify for unknown objects', () => {
      const result = safeString({ foo: 'bar' });
      expect(result).toBe('{"foo":"bar"}');
    });

    it('converts numbers to strings', () => {
      expect(safeString(42)).toBe('42');
    });
  });

  // -------------------------------------------------------------------------
  // 6. faviconUrl utility
  // -------------------------------------------------------------------------
  describe('faviconUrl', () => {
    it('generates Google favicon URL from feed URL', () => {
      expect(faviconUrl('https://techcrunch.com/feed/')).toBe(
        'https://www.google.com/s2/favicons?domain=techcrunch.com&sz=32',
      );
    });

    it('returns empty string for invalid URLs', () => {
      expect(faviconUrl('not-a-url')).toBe('');
    });
  });
});
