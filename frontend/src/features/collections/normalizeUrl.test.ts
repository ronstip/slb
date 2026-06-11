import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './collectionsPostColumns.tsx';

describe('normalizeUrl', () => {
  describe('instagram', () => {
    it('treats reel and p paths for the same shortcode as equal', () => {
      const reel = normalizeUrl('https://www.instagram.com/reel/DZZWjfJgPd1/?igsh=eGRseHVhaHlhYXg4');
      const post = normalizeUrl('https://www.instagram.com/p/DZZWjfJgPd1/');
      expect(reel).toBe(post);
      expect(reel).toBe('instagram.com/p/DZZWjfJgPd1');
    });

    it('canonicalises reels and tv path types too', () => {
      expect(normalizeUrl('https://instagram.com/reels/AbC_1/')).toBe('instagram.com/p/AbC_1');
      expect(normalizeUrl('https://instagram.com/tv/AbC_1')).toBe('instagram.com/p/AbC_1');
    });

    it('preserves shortcode case (IG shortcodes are case-sensitive)', () => {
      expect(normalizeUrl('https://m.instagram.com/p/AbC/')).toBe('instagram.com/p/AbC');
    });
  });

  describe('twitter / x', () => {
    it('treats x.com and twitter.com status links as equal', () => {
      const x = normalizeUrl('https://x.com/elonmusk/status/123?s=20&t=abc');
      const tw = normalizeUrl('https://twitter.com/someoneelse/status/123/');
      expect(x).toBe(tw);
      expect(x).toBe('twitter.com/status/123');
    });

    it('handles i/web/status and mobile', () => {
      expect(normalizeUrl('https://mobile.twitter.com/i/web/status/99')).toBe('twitter.com/status/99');
    });
  });

  describe('tiktok', () => {
    it('keys on the numeric video id, dropping tracking params', () => {
      expect(normalizeUrl('https://www.tiktok.com/@user/video/12345?is_from_webapp=1&lang=en'))
        .toBe('tiktok.com/video/12345');
    });

    it('treats photo posts in the same id space', () => {
      expect(normalizeUrl('https://www.tiktok.com/@u/photo/777')).toBe('tiktok.com/video/777');
    });
  });

  describe('youtube', () => {
    it('treats watch?v=, youtu.be and shorts for the same id as equal', () => {
      const watch = normalizeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s');
      const short = normalizeUrl('https://youtu.be/dQw4w9WgXcQ');
      const shorts = normalizeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
      expect(watch).toBe('youtube.com/v/dQw4w9WgXcQ');
      expect(short).toBe(watch);
      expect(shorts).toBe(watch);
    });

    it('extracts v= even when other params precede it', () => {
      expect(normalizeUrl('https://youtube.com/watch?feature=share&v=abc123&t=5'))
        .toBe('youtube.com/v/abc123');
    });

    it('does NOT collapse different videos together', () => {
      expect(normalizeUrl('https://youtube.com/watch?v=AAA'))
        .not.toBe(normalizeUrl('https://youtube.com/watch?v=BBB'));
    });
  });

  describe('reddit', () => {
    it('keys on the comment id, dropping subreddit, slug and subdomain', () => {
      const a = normalizeUrl('https://www.reddit.com/r/soccer/comments/abc123/some_title/');
      const b = normalizeUrl('https://old.reddit.com/r/soccer/comments/abc123/');
      const short = normalizeUrl('https://redd.it/abc123');
      expect(a).toBe('reddit.com/comments/abc123');
      expect(b).toBe(a);
      expect(short).toBe(a);
    });
  });

  describe('facebook', () => {
    it('keys on the numeric id across watch / videos / reel forms', () => {
      expect(normalizeUrl('https://www.facebook.com/watch/?v=123')).toBe('facebook.com/123');
      expect(normalizeUrl('https://facebook.com/somepage/videos/123/')).toBe('facebook.com/123');
      expect(normalizeUrl('https://m.facebook.com/reel/123')).toBe('facebook.com/123');
    });
  });

  describe('generic fallback', () => {
    it('strips protocol, www, query, fragment, trailing slash and lowercases', () => {
      expect(normalizeUrl('https://www.Example.com/Some/Path/?a=1#x')).toBe('example.com/some/path');
    });

    it('is whitespace tolerant', () => {
      expect(normalizeUrl('  https://example.com/p/  ')).toBe('example.com/p');
    });
  });
});
