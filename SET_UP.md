# Setup

Playwright API suite for **loanwalk** use cases. Configured store for now: **STG USA 23005**.

Specs live in `tests/loanwalk`. The end-to-end flow is **`GMwalk.spec.ts`** (serial GET → PUT → POST with separate Allure/Teams attachments per scenario). Add another env or store later by copying `test-data/datasets/stg/usa/23005/`.

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

```bat
npm run gmwalk
```

Runs four serial tests in `GMwalk.spec.ts`: GET count, GET screen, PUT, POST.

Teams card after the chain: `npm run gmwalk:teams` (or `npm run lnwalk:teams`). Needs `TEAMS_WEBHOOK_URL` in `.env`. Scheduled: [TEAMS_SETUP.md](TEAMS_SETUP.md) — `scripts\run_scheduled.bat`.

```bat
npm run teams:verify-webhook
```

One scenario only: use Playwright `--grep` on the test title, e.g. `node scripts/run-env.mjs ENV=stg COUNTRY=usa STORE=23005 -- tests/loanwalk/GMwalk.spec.ts --grep "PUT —"`.

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
