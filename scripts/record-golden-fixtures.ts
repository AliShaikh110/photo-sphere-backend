import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { recordGoldenArtifact, serializeGoldenArtifact } from '../tests/golden/record';
import { goldenScenarios } from '../tests/golden/scenarios';

/**
 * Re-records the compiler behaviour freeze.
 *
 * Run this only when a compiled-output change is intended and reviewed: the
 * committed fixtures are the evidence that a refactor changed nothing, so
 * re-recording to make a failing test pass destroys the thing being protected.
 */
const outputDirectory = path.resolve(__dirname, '..', 'tests', 'golden', 'expected');

function main(): void {
  mkdirSync(outputDirectory, { recursive: true });
  for (const scenario of goldenScenarios()) {
    const artifact = recordGoldenArtifact(scenario);
    const file = path.join(outputDirectory, `${scenario.id}.json`);
    writeFileSync(file, serializeGoldenArtifact(artifact), 'utf8');
    process.stdout.write(`recorded ${scenario.id} (${artifact.outcome})\n`);
  }
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}
