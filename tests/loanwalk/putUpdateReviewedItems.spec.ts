import { test, expect } from '@playwright/test';
import {
  createTestContext,
  datasetExists,
  resolveCountriesForPilot,
  resolveEnvsForPilot,
  resolveStoresForPilot,
} from '../../utils/testContext';
import {
  tryChainAfterGet,
  writeLoanwalkChainState,
  type LoanwalkChainState,
} from './helpers/loanwalkChainState';
import {
  assertScreenSizeReadable,
  decideScreenSizeUpdate,
  fetchContractsFromGet,
  readScreenForFlowItem,
  reviewStamps,
  type UpdateDataset,
} from './helpers/loanwalkReview';

const GET_ENDPOINT_KEY = 'getContractsByType' as const;
const PUT_ENDPOINT_KEY = 'putUpdateReviewedItems' as const;
const GET_DATA_KEY = 'loanwalk/getContractsByType';
const PUT_DATA_KEY = 'loanwalk/putUpdateReviewedItems';

const PILOT_ENVS = ['stg'];
const PILOT_COUNTRIES = ['usa'];
const STORE_MAP: Record<string, string[]> = {
  usa: ['23005'],
};

function shouldWriteChainAfterPut(): boolean {
  return process.env.LOANWALK_WRITE_CHAIN !== '0';
}

function useStandalonePut(): boolean {
  return (
    process.env.LOANWALK_PUT_STANDALONE === '1' ||
    process.env.LOANWALK_FORCE_STANDALONE_PUT === '1'
  );
}

test.describe('Loanwalk PUT update reviewed items', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  for (const env of resolveEnvsForPilot(PILOT_ENVS)) {
    for (const country of resolveCountriesForPilot(PILOT_COUNTRIES)) {
      for (const store of resolveStoresForPilot(STORE_MAP[country] ?? [])) {
        if (!datasetExists({ env, country, store, dataKey: GET_DATA_KEY })) continue;
        if (!datasetExists({ env, country, store, dataKey: PUT_DATA_KEY })) continue;

        test(`PUT screen size toggle — ENV=${env} COUNTRY=${country} STORE=${store}`, async ({ request }, testInfo) => {
          const ctx = createTestContext({ env, country, store });
          const flow = ctx.data<UpdateDataset>(PUT_DATA_KEY);
          const getUrl = ctx.url(GET_ENDPOINT_KEY);
          const putUrl = ctx.url(PUT_ENDPOINT_KEY);
          const getHeaders = ctx.headers;
          const putHeaders = { ...(flow.putHeaders ?? {}), 'api-key': ctx.headers['api-key'] };

          let mode: 'chain' | 'standalone';
          let chainBase: LoanwalkChainState;
          let initialScreenSize: string;

          const chained = !useStandalonePut() ? tryChainAfterGet(env, country, store) : undefined;

          if (chained) {
            mode = 'chain';
            initialScreenSize = chained.initialScreenSize;
            chainBase = chained;
            await testInfo.attach('PUT mode', {
              body: 'chain — using initialScreenSize from getContractsByType.spec.ts',
              contentType: 'text/plain',
            });
          } else {
            mode = 'standalone';
            await testInfo.attach('PUT mode', {
              body:
                'standalone — GET in this spec reads screen, then PUT; verified with GET after PUT',
              contentType: 'text/plain',
            });

            const { httpStatus, contracts } = await fetchContractsFromGet(request, getUrl, getHeaders);
            if (httpStatus !== 200) {
              throw new Error(
                `Test Failed: Standalone PUT could not GET contracts.\n` +
                  `Expected: 200\n` +
                  `Received: ${httpStatus}`
              );
            }

            const screenHit = readScreenForFlowItem(contracts, flow);
            assertScreenSizeReadable(screenHit, flow);
            initialScreenSize = screenHit.current;

            await testInfo.attach('Standalone GET — screen before PUT', {
              body: `current: ${screenHit.current} (${screenHit.source})`,
              contentType: 'text/plain',
            });

            chainBase = {
              env,
              country,
              store,
              contractEzId: flow.contractEzId,
              itemEzId: flow.itemEzId,
              screenSizeAttributeKey: flow.screenSizeAttributeKey,
              initialScreenSize,
              step: 'get',
            };
          }

          const decision = decideScreenSizeUpdate(initialScreenSize);
          if (!decision) {
            throw new Error(
              `Test Failed: Screen size is not 13 or 15.\n` +
                `Expected: 13 or 15\n` +
                `Received: ${initialScreenSize}`
            );
          }

          expect(decision.oldVal).toBe(initialScreenSize);

          const stamps = reviewStamps();
          const putBody = structuredClone(flow.request);
          const feature = putBody.item.itemChanges.features[0];
          feature.oldVal = decision.oldVal;
          feature.newVal = decision.newVal;
          putBody.item.reviewedDttmLocation = stamps.location;
          putBody.item.reviewedDttmUTC = stamps.utc;
          putBody.item.itemChanges.scanDttm = stamps.utc;
          putBody.item.itemChanges.dmwalkDttm = stamps.utc;
          putBody.item.itemChanges.comments[0].createdOn = stamps.utc;
          putBody.item.itemChanges.comments[0].comments =
            `Screen size corrected from ${decision.oldVal} to ${decision.newVal}`;

          await testInfo.attach('Screen toggle', {
            body: `${initialScreenSize} → ${decision.newVal}`,
            contentType: 'text/plain',
          });
          await testInfo.attach('PUT body', {
            body: JSON.stringify(putBody, null, 2),
            contentType: 'application/json',
          });

          const putRes = await request.put(putUrl, { headers: putHeaders, data: putBody });

          if (putRes.status() !== 200) {
            throw new Error(
              `Test Failed: PUT update reviewed items failed.\n` +
                `Expected: 200\n` +
                `Received: ${putRes.status()}\n` +
                `What should have been: Screen size ${decision.oldVal} → ${decision.newVal} should persist.`
            );
          }

          await test.step('PUT returns 200 with toggled feature newVal', async () => {
            expect(putRes.status()).toBe(200);
            expect(feature.newVal).toBe(decision.newVal);
          });

          await test.step('GET after PUT shows updated screen size', async () => {
            const { httpStatus, contracts } = await fetchContractsFromGet(request, getUrl, getHeaders);
            expect(httpStatus).toBe(200);
            const afterHit = readScreenForFlowItem(contracts, flow);
            assertScreenSizeReadable(afterHit, flow);
            expect(afterHit.current).toBe(decision.newVal);
            await testInfo.attach('GET after PUT — screen', {
              body: `current: ${afterHit.current} (expected ${decision.newVal})`,
              contentType: 'text/plain',
            });
          });

          if (shouldWriteChainAfterPut()) {
            writeLoanwalkChainState({
              ...chainBase,
              updatedScreenSize: decision.newVal,
              step: 'put',
            });
          }

          const modeLabel = mode === 'chain' ? 'chain step 2' : 'standalone';
          await testInfo.attach('Required Attributes Validated ✅', {
            body: [
              `Loanwalk PUT (${modeLabel}):`,
              `✅ Screen before PUT: ${initialScreenSize}`,
              `✅ PUT ${decision.oldVal} → ${decision.newVal}`,
              `✅ GET after PUT confirms screen ${decision.newVal}`,
              shouldWriteChainAfterPut()
                ? `✅ Chain state updated for optional POST`
                : `ℹ️ Chain file not written (LOANWALK_WRITE_CHAIN=0)`,
            ].join('\n'),
            contentType: 'text/plain',
          });

          await testInfo.attach('Validation Summary', {
            body: [
              `Mode: ${mode}`,
              `ENV: ${env}`,
              `Store: ${flow.storeId}`,
              `contractEzId: ${flow.contractEzId}`,
              `itemEzId: ${flow.itemEzId}`,
              `Screen before PUT: ${initialScreenSize}`,
              `PUT target: ${decision.newVal}`,
              `PUT status: ${putRes.status()}`,
            ].join('\n'),
            contentType: 'text/plain',
          });
        });
      }
    }
  }
});
