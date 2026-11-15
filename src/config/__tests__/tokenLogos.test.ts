import { describe, expect, it, vi } from 'vitest';

import { BLUE_CHIPS, cryptoLogoUrl } from '../../features/crypto/config/blueChips';
import { chainLogoUrls } from '../logodev';
import { chainLogoUrl, tokenLogoUrl } from '../tokenLogos';

// vitest hoists this above the imports: env.ts reads expo-constants at load.
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const COINGECKO = 'https://coin-images.coingecko.com/';

describe('tokenLogoUrl', () => {
  it('finds a symbol in any case', () => {
    expect(tokenLogoUrl('USDC')).toBe(`${COINGECKO}coins/images/6319/large/USDC.png`);
    expect(tokenLogoUrl(' usdc ')).toBe(tokenLogoUrl('USDC'));
    expect(tokenLogoUrl('wstETH')).toContain('/wstETH.png');
  });

  it('follows aliases', () => {
    expect(tokenLogoUrl('euroc')).toBe(tokenLogoUrl('EURC'));
    expect(tokenLogoUrl('cbXRP')).toBe(tokenLogoUrl('XRP'));
  });

  it('returns null for a symbol it does not list', () => {
    expect(tokenLogoUrl('NOPE')).toBeNull();
    expect(tokenLogoUrl('')).toBeNull();
    expect(tokenLogoUrl(null)).toBeNull();
    // Not an own property of the table
    expect(tokenLogoUrl('constructor')).toBeNull();
  });
});

describe('chainLogoUrl', () => {
  it('covers every chain the app can send to or bridge from', () => {
    for (const key of ['BASE', 'ETH', 'OP', 'POL', 'ARB', 'GNO']) {
      expect(chainLogoUrl(key), key).toMatch(/^https:\/\/coin-images\.coingecko\.com\/asset_platforms\//);
    }
    expect(chainLogoUrl('NOPE')).toBeNull();
  });
});

describe('without a logo.dev key', () => {
  it('every listed token still has a logo', () => {
    const missing = BLUE_CHIPS.filter((token) => !cryptoLogoUrl(token)).map((token) => token.symbol);
    expect(missing).toEqual([]);
  });

  it('chains use the keyless logo', () => {
    expect(chainLogoUrls('BASE')).toEqual([chainLogoUrl('BASE')]);
    expect(chainLogoUrls('NOPE')).toEqual([]);
  });
});
