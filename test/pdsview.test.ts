import { describe, it, expect } from 'vitest';
import {
  PDS_DID,
  isConfigured,
  rkeyForLevel,
  levelUrl,
  lexiconUrl,
} from '../src/pdsview';

describe('pdsview link construction', () => {
  it('is unconfigured while the DID is a placeholder', () => {
    // Guards against shipping a live-looking link with no real repo behind it.
    expect(PDS_DID).toContain('REPLACEME');
    expect(isConfigured()).toBe(false);
  });

  it('slugifies level names into stable record keys', () => {
    expect(rkeyForLevel('Villain House!')).toBe('villain-house');
    expect(rkeyForLevel('  spaced  out  ')).toBe('spaced-out');
    expect(rkeyForLevel('')).toBe('level');
    expect(rkeyForLevel('///')).toBe('level');
  });

  it('builds DID-canonical pdsview URLs matching #/at/<did>/<collection>/<rkey>', () => {
    const url = levelUrl('Boom Town');
    expect(url).toBe(
      `https://pdsview.croft.ing/#/at/${PDS_DID}/ing.croft.levelforge.level/boom-town`,
    );
  });

  it('points the lexicon link at the standard schema collection', () => {
    expect(lexiconUrl()).toBe(
      `https://pdsview.croft.ing/#/at/${PDS_DID}/com.atproto.lexicon.schema/ing.croft.levelforge.level`,
    );
  });
});
