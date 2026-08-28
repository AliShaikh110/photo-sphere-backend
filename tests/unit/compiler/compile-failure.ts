import { ExperienceCompilationError } from '@alishaikh110/experience-compiler';

/**
 * Compilation is synchronous and pure, so a refusal to compile is a thrown
 * error rather than a rejected promise.
 */
export function compileFailure(compile: () => unknown): ExperienceCompilationError {
  try {
    compile();
  } catch (error) {
    if (error instanceof ExperienceCompilationError) return error;
    throw error;
  }
  throw new Error('Expected the compile to fail.');
}
