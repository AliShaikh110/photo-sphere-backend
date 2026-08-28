import { describe, expect, it } from 'vitest';

import {
  NoCompatibleVideoProfileError,
  defaultCandidateOrder,
  selectVideoPlaybackProfile,
  type VideoProfileCandidate
} from '@alishaikh110/experience-schema';

const desktop: VideoProfileCandidate = {
  profileId: 'desktop',
  derivativeId: 'derivative-desktop',
  mimeType: 'video/mp4',
  width: 8_192,
  height: 4_096,
  handheldSafe: false
};

const mobile: VideoProfileCandidate = {
  profileId: 'mobile',
  derivativeId: 'derivative-mobile',
  mimeType: 'video/mp4',
  width: 4_096,
  height: 2_048,
  handheldSafe: true
};

describe('device-aware video playback selection', () => {
  it('orders published candidates so a handheld-safe profile leads', () => {
    expect(defaultCandidateOrder([desktop, mobile]).map((candidate) => candidate.profileId))
      .toEqual(['mobile', 'desktop']);
  });

  it('rejects an oversized profile on a handheld device', () => {
    const selection = selectVideoPlaybackProfile([desktop, mobile], { handheld: true });

    expect(selection.selected.profileId).toBe('mobile');
    expect(selection.reason).toBe('handheld-width-constraint');
    expect(selection.rejected).toContainEqual({
      profileId: 'desktop',
      reason: 'exceeds-handheld-width'
    });
  });

  it('prefers the highest quality profile on an unconstrained device', () => {
    const selection = selectVideoPlaybackProfile([mobile, desktop], {});
    expect(selection.selected.profileId).toBe('desktop');
    expect(selection.ordered.map((candidate) => candidate.profileId)).toEqual(['desktop', 'mobile']);
  });

  it('honours a hardware texture ceiling', () => {
    const selection = selectVideoPlaybackProfile([desktop, mobile], { maxTextureSize: 4_096 });
    expect(selection.selected.profileId).toBe('mobile');
    expect(selection.rejected).toContainEqual({
      profileId: 'desktop',
      reason: 'exceeds-max-texture-size'
    });
  });

  it('steps down on data saver and constrained networks', () => {
    expect(selectVideoPlaybackProfile([desktop, mobile], { dataSaver: true }).selected.profileId)
      .toBe('mobile');
    expect(
      selectVideoPlaybackProfile([desktop, mobile], { networkClass: 'constrained' })
        .selected.profileId
    ).toBe('mobile');
  });

  it('excludes candidates the browser cannot decode', () => {
    const webmOnly = selectVideoPlaybackProfile(
      [desktop, { ...mobile, mimeType: 'video/webm' }],
      { supportedMimeTypes: ['video/webm'] }
    );
    expect(webmOnly.selected.profileId).toBe('mobile');
  });

  it('fails loudly rather than falling back to an unsupported source', () => {
    expect(() => selectVideoPlaybackProfile([desktop], { handheld: true }))
      .toThrowError(NoCompatibleVideoProfileError);
    expect(() => selectVideoPlaybackProfile([]))
      .toThrowError(NoCompatibleVideoProfileError);
  });
});
