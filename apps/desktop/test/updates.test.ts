import { describe, expect, it } from 'vitest';
import { newer, readRelease } from '../src/update-feed.ts';

describe('update feed', () => {
  it('compares versions number by number', () => {
    expect(newer('0.1.1', '0.1.0')).toBe(true);
    expect(newer('v1.10.0', '1.9.2')).toBe(true);
    expect(newer('1.0', '1.0.0')).toBe(false);
    expect(newer('0.1.0', '0.1.0')).toBe(false);
    expect(newer('0.2.0-beta.1', '0.2.0')).toBe(false);
    expect(newer('0.0.9', '0.1.0')).toBe(false);
  });

  it('finds the app for this Mac in a release, and only a published one', () => {
    const release = {
      tag_name: 'v0.2.0', html_url: 'https://github.com/x/nib/releases/tag/v0.2.0', draft: false, prerelease: false,
      assets: [
        { name: 'nib-0.2.0-arm64.dmg', browser_download_url: 'https://x/dmg', size: 1 },
        { name: 'nib-0.2.0-mac-arm64.zip', browser_download_url: 'https://x/arm', size: 10 },
        { name: 'nib-0.2.0-mac-x64.zip', browser_download_url: 'https://x/intel', size: 11 },
        { name: 'nib-0.2.0-win-x64.zip', browser_download_url: 'https://x/win', size: 12 },
      ],
    };
    expect(readRelease(release, 'darwin', 'arm64')).toEqual({ version: '0.2.0', url: release.html_url, asset: { name: 'nib-0.2.0-mac-arm64.zip', url: 'https://x/arm', size: 10 } });
    expect(readRelease(release, 'darwin', 'x64')?.asset?.url).toBe('https://x/intel');
    // Elsewhere nib only points to the release.
    expect(readRelease(release, 'win32', 'x64')).toEqual({ version: '0.2.0', url: release.html_url });
    expect(readRelease({ ...release, prerelease: true }, 'darwin', 'arm64')).toBeUndefined();
    expect(readRelease({ message: 'Not Found' }, 'darwin', 'arm64')).toBeUndefined();
  });
});
