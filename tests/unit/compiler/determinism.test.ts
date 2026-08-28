import { describe, expect, it, vi } from 'vitest';

import { compile, contentHash, tryCompile } from '@sphere/experience-compiler';
import { goldenCompileInput } from '../../golden/record';
import { goldenScenarios } from '../../golden/scenarios';

const compilable = goldenScenarios().filter((scenario) => scenario.expectRejection !== true);

describe('compiler determinism', () => {
  it('produces identical output and hash when called twice on the same input', () => {
    for (const scenario of compilable) {
      const input = goldenCompileInput(scenario);
      const first = compile(input);
      const second = compile(input);
      expect(JSON.stringify(second.manifest)).toBe(JSON.stringify(first.manifest));
      expect(JSON.stringify(second.sceneDefinitions)).toBe(JSON.stringify(first.sceneDefinitions));
      expect(JSON.stringify(second.sceneIndex)).toBe(JSON.stringify(first.sceneIndex));
      expect(second.contentHash).toBe(first.contentHash);
    }
  });

  it('produces the same output when the clock and the random source move', () => {
    const scenario = compilable[0]!;
    const input = goldenCompileInput(scenario);
    const before = compile(input);

    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.123_456);
    try {
      const firstShift = compile(input);
      clock.mockReturnValue(9_999_999_999);
      random.mockReturnValue(0.987_654);
      const secondShift = compile(input);
      expect(firstShift.contentHash).toBe(before.contentHash);
      expect(secondShift.contentHash).toBe(before.contentHash);
    } finally {
      clock.mockRestore();
      random.mockRestore();
    }
  });

  it('compiles synchronously, so no input can be fetched mid-compile', () => {
    const result = compile(goldenCompileInput(compilable[0]!));
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result.contentHash).toBe('string');
  });

  it('hashes the compiled output, not the object identity', () => {
    const input = goldenCompileInput(compilable[0]!);
    const result = compile(input);
    expect(result.contentHash).toBe(contentHash({
      manifest: result.manifest,
      sceneDefinitions: result.sceneDefinitions,
      sceneIndex: result.sceneIndex
    }));
    // A key-sorted rendering, so a differently ordered but equal manifest hashes the same.
    const reordered = JSON.parse(
      JSON.stringify({
        sceneIndex: result.sceneIndex,
        manifest: result.manifest,
        sceneDefinitions: result.sceneDefinitions
      })
    ) as Record<string, unknown>;
    expect(contentHash(reordered)).toBe(result.contentHash);
  });

  it('reports a refusal as diagnostics rather than an exception when asked to', () => {
    const rejected = goldenScenarios().find((scenario) => scenario.expectRejection === true)!;
    const outcome = tryCompile(goldenCompileInput(rejected));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.diagnostics.length).toBeGreaterThan(0);
    expect(outcome.diagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(outcome.diagnostics.every((diagnostic) => typeof diagnostic.path === 'string')).toBe(true);
  });

  it('surfaces an applied capability fallback as a warning a creator can act on', () => {
    const fallbackScenario = goldenScenarios()
      .find((scenario) => scenario.id === 'image360-capability-fallback')!;
    const result = compile(goldenCompileInput(fallbackScenario));
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === 'warning')).toBe(true);
  });
});
