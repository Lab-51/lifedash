import { describe, it, expect } from 'vitest';
import { isHallucinatedSegment, findMatchedHallucinationPhrase } from './hallucinationFilter';

describe('isHallucinatedSegment', () => {
  it('matches a Czech subtitle-credit phrase with a credited name (length slack)', () => {
    expect(isHallucinatedSegment('Titulky vytvořil Jirka Kováček')).toBe(true);
  });

  it('matches an English outro wrapped in music-note glyphs', () => {
    expect(isHallucinatedSegment('♪ Thanks for watching ♪')).toBe(true);
  });

  it('matches a segment that is only a URL', () => {
    expect(isHallucinatedSegment('www.example.com')).toBe(true);
  });

  it('matches other known phrases from the blacklist', () => {
    expect(isHallucinatedSegment('thank you for watching')).toBe(true);
    expect(isHallucinatedSegment('Subtitles by John Doe')).toBe(true);
    expect(isHallucinatedSegment('Titulky vytvoril')).toBe(true);
    expect(isHallucinatedSegment('Preklad a titulky')).toBe(true);
    expect(isHallucinatedSegment('amara.org')).toBe(true);
  });

  it('does NOT match a long Czech sentence that merely mentions titulky', () => {
    const longSentence =
      'Musíme si sednout a probrat, jak budeme dělat titulky pro příští video, protože poslední várka trvala příliš dlouho a nikdo z týmu na to neměl kapacitu, takže hledáme nové řešení.';
    expect(longSentence.length).toBeGreaterThan(100);
    expect(isHallucinatedSegment(longSentence)).toBe(false);
  });

  it('does NOT match normal speech', () => {
    expect(isHallucinatedSegment("Let's move the deadline to next Friday and sync with design.")).toBe(false);
  });

  it('does NOT match an empty string', () => {
    expect(isHallucinatedSegment('')).toBe(false);
    expect(isHallucinatedSegment('   ')).toBe(false);
  });

  it('does NOT match a sentence containing a URL among other words', () => {
    expect(isHallucinatedSegment('You can find it at www.example.com if you look there.')).toBe(false);
  });
});

describe('findMatchedHallucinationPhrase', () => {
  it('returns the matched phrase for logging', () => {
    expect(findMatchedHallucinationPhrase('Thanks for watching')).toBe('thanks for watching');
  });

  it('returns null when there is no match', () => {
    expect(findMatchedHallucinationPhrase('Normal meeting speech')).toBeNull();
  });
});
