# Setup

Playwright API suite for **loanwalk** use cases. Configured store for now: **STG USA 23005**.

Specs live in `tests/loanwalk`. Each spec checks a use case (the outcome), not every response attribute. Add another env or store later by copying `test-data/datasets/stg/usa/23005/`. Extend the **`gmwalk`** script in `package.json` when a new spec belongs in the chain; run single specs with `node scripts/run-env.mjs` yourself.

## Requirements

- Node.js 20 LTS (`node -v`, `npm -v`)
- Network to the STG API
- Java 17 only if you need Allure (`npm run report`)

## Install

```bash
cd Backendapi
npm install
npx playwright install chromium
```

`.env` is already filled from the ezcorpautomation STG key and is gitignored. Template: [`.env.example`](.env.example).

```env
STG_SHOWCASE_API_KEY=...
TEAMS_WEBHOOK_URL=
TEAMS_DEBUG=0
```

Store credentials (base URL, header names, which env var holds the key) are in `test-data/datasets/stg/usa/23005/config.json`.

## Run

Full chain (GET → PUT → POST, `--workers=1`):

```bat
npm run gmwalk
```

Teams card after the chain: set `TEAMS_NOTIFY=1` in the shell, then `npm run gmwalk`. Scheduled runs: [TEAMS_SETUP.md](TEAMS_SETUP.md) (`scripts\run_scheduled.bat` sets `TEAMS_NOTIFY=1` and calls `gmwalk`).

```bat
npm run teams:verify-webhook
```

Single specs: use `node scripts/run-env.mjs ENV=stg COUNTRY=usa STORE=23005 -- tests/loanwalk/02-putUpdateReviewedItems.spec.ts` (add env vars such as `LOANWALK_PUT_STANDALONE=1` before `--` when needed). Chain files are prefixed `01-`, `02-`, `03-` so `tests/loanwalk` always runs GET → PUT → POST.

## Adding a use case

1. Add request params at `test-data/datasets/stg/usa/23005/data/loanwalk/<endpointKey>.json` with a `params` object.
2. Add `tests/loanwalk/<endpointKey>.spec.ts`.
3. Call the API with `createTestContext()`, then `assertUseCases()` from `utils/useCase.ts`.

```ts
import { test } from '@playwright/test';
import { createTestContext } from '../../utils/testContext';
import { assertUseCases, attachUseCaseSummary, type UseCaseCheck } from '../../utils/useCase';

test('contracts for the requested store come back', async ({ request }, testInfo) => {
  const ctx = createTestContext();
  const response = await request.get(ctx.url('getContractsByType'), { headers: ctx.headers });
  const body = await response.json();

  const checks: UseCaseCheck[] = [
    {
      name: 'Request is accepted',
      pass: response.status() === 200 && body.success === true,
      expected: '200 and success true',
      received: `${response.status()} and success ${body.success}`,
      why: 'A valid store and date range should return a successful envelope.',
    },
  ];

  await attachUseCaseSummary(testInfo, checks);
  assertUseCases(checks);
});
```
