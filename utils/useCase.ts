/**
 * Use-case checks for loanwalk.
 *
 * Assert the behavior the caller cares about (status, store, date window,
 * a contract is returned, review was accepted). Do not walk every attribute.
 *
 * Failures use the same Expected / Received / What should have been lines
 * the Teams reporter already posts.
 */

import type { TestInfo } from '@playwright/test';

export type UseCaseCheck = {
  /** Short name of the use case, shown in the Validation Summary. */
  name: string;
  pass: boolean;
  expected: string;
  received: string;
  /** What the API should have done when this check fails. */
  why: string;
};

export function assertUseCases(checks: UseCaseCheck[]): void {
  const failed = checks.filter((check) => !check.pass);
  if (failed.length === 0) return;

  const [first, ...rest] = failed;
  const also =
    rest.length > 0 ? `\nAlso failed: ${rest.map((check) => check.name).join(', ')}` : '';

  throw new Error(
    `Test Failed: ${first.name}\n` +
      `Expected: ${first.expected}\n` +
      `Received: ${first.received}\n` +
      `What should have been: ${first.why}${also}`
  );
}

/** Attach the use-case list so the Teams card shows what was validated. */
export async function attachUseCaseSummary(
  testInfo: TestInfo,
  checks: UseCaseCheck[]
): Promise<void> {
  const lines = checks.map((check) => `${check.pass ? '✅' : '❌'} ${check.name}`);
  await testInfo.attach('Validation Summary', {
    body: lines.join('\n'),
    contentType: 'text/plain',
  });
}
