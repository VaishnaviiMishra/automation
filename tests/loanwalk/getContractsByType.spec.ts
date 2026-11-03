import { test, expect } from '@playwright/test';
import {
  createTestContext,
  datasetExists,
  resolveCountriesForPilot,
  resolveEnvsForPilot,
  resolveStoresForPilot,
} from '../../utils/testContext';
import { writeLoanwalkChainState } from './helpers/loanwalkChainState';
import { readScreenSizeFromGet, type LoanContract, type UpdateDataset } from './helpers/loanwalkReview';

const ENDPOINT_KEY = 'getContractsByType' as const;
const DATA_KEY = 'loanwalk/getContractsByType';
const PUT_DATA_KEY = 'loanwalk/putUpdateReviewedItems';
const POST_PARAMS_KEY = 'loanwalk/postReviewedItemPriceDrop';

const PILOT_ENVS = ['stg'];
const PILOT_COUNTRIES = ['usa'];
const STORE_MAP: Record<string, string[]> = {
  usa: ['23005'],
};

test.describe('Loanwalk Contracts By Type', () => {
  test.describe.configure({ timeout: 60_000 });

  for (const env of resolveEnvsForPilot(PILOT_ENVS)) {
    for (const country of resolveCountriesForPilot(PILOT_COUNTRIES)) {
      for (const store of resolveStoresForPilot(STORE_MAP[country] ?? [])) {
        if (!datasetExists({ env, country, store, dataKey: DATA_KEY })) continue;

        const chainEnabled =
          datasetExists({ env, country, store, dataKey: PUT_DATA_KEY }) &&
          datasetExists({ env, country, store, dataKey: POST_PARAMS_KEY });

        test(`GET contracts by type — ENV=${env} COUNTRY=${country} STORE=${store}`, async ({ request }, testInfo) => {
          const ctx = createTestContext({ env, country, store });
          const params = ctx.params(ENDPOINT_KEY);
          const fullUrl = ctx.url(ENDPOINT_KEY);
          const headers = ctx.headers;

          const response = await request.get(fullUrl, { headers });
          const responseData = await response.json();
          const contracts = responseData?.payload?.contracts;
          const totalRecords = responseData?.pageable?.totalRecords;
          const itemCount = Array.isArray(contracts) ? contracts.length : -1;
          const countsMatch = itemCount === totalRecords;

          await testInfo.attach('ENV / Country / Store', {
            body: JSON.stringify(
              { env: ctx.meta.env, country: ctx.meta.country, store: ctx.meta.store, params },
              null,
              2
            ),
            contentType: 'application/json',
          });
          await testInfo.attach('Request URL', { body: fullUrl, contentType: 'text/plain' });
          await testInfo.attach('Request Headers', {
            body: JSON.stringify({ ...headers, 'api-key': '***' }, null, 2),
            contentType: 'application/json',
          });
          await testInfo.attach('pageable', {
            body: JSON.stringify(responseData?.pageable ?? null, null, 2),
            contentType: 'application/json',
          });

          if (response.status() !== 200) {
            throw new Error(
              `Test Failed: API endpoint responded with an incorrect status code.\n` +
                `Expected: 200 OK\n` +
                `Received: ${response.status()}\n` +
                `What should have been: GET contracts by type for store ${params.storeId} should return 200.`
            );
          }

          await test.step('Verify that the API endpoint responds with a 200 OK status', async () => {
            expect(response.status()).toBe(200);
          });

          if (!Array.isArray(contracts) || typeof totalRecords !== 'number' || !countsMatch) {
            throw new Error(
              `Test Failed: Returned contract count does not match totalRecords.\n` +
                `Expected: payload.contracts length === pageable.totalRecords\n` +
                `Received: items counted ${itemCount}, totalRecords ${totalRecords}\n` +
                `What should have been: The number of contracts in the response should equal pageable.totalRecords.`
            );
          }

          await test.step('Verify that the counted contracts match pageable.totalRecords', async () => {
            expect(itemCount).toBe(totalRecords);
          });

          let chainLines: string[] = [];
          if (chainEnabled) {
            const flow = ctx.data<UpdateDataset>(PUT_DATA_KEY);
            const contractsList = contracts as LoanContract[];
            const screenHit = readScreenSizeFromGet(
              contractsList,
              flow.contractEzId,
              flow.itemEzId,
              flow.screenSizeAttributeKey
            );

            await testInfo.attach('Chain — target item screen (GET)', {
              body: screenHit
                ? `current: ${screenHit.current} (${screenHit.source})`
                : 'screen size not found on contract item',
              contentType: 'text/plain',
            });

            if (!screenHit?.current) {
              throw new Error(
                `Test Failed: Could not read screen size for chain item.\n` +
                  `Expected: screen on contract ${flow.contractEzId} item ${flow.itemEzId}\n` +
                  `Received: missing\n` +
                  `What should have been: GET must expose current screen for PUT/POST chain.`
              );
            }

            await test.step('Store current screen size for PUT and POST chain', async () => {
              expect(screenHit.current).toMatch(/^(13|15)$/);
            });

            writeLoanwalkChainState({
              env,
              country,
              store,
              contractEzId: flow.contractEzId,
              itemEzId: flow.itemEzId,
              screenSizeAttributeKey: flow.screenSizeAttributeKey,
              initialScreenSize: screenHit.current,
              step: 'get',
            });

            chainLines = [
              `✅ Stored initialScreenSize ${screenHit.current} for PUT → POST chain`,
            ];
          }

          await testInfo.attach('Required Attributes Validated ✅', {
            body: [
              'Use case checks for GET contracts by type:',
              '✅ HTTP 200',
              `✅ Item count matches totalRecords (${itemCount} === ${totalRecords})`,
              ...chainLines,
            ].join('\n'),
            contentType: 'text/plain',
          });

          await testInfo.attach('Validation Summary', {
            body: [
              `ENV: ${env}`,
              `Country: ${country}`,
              `Store: ${params.storeId}`,
              `contractType: ${params.contractType}`,
              `fromDate: ${params.fromDate}`,
              `toDate: ${params.toDate}`,
              `pageNo: ${params.pageNo}`,
              `pageSize: ${params.pageSize}`,
              `Items counted: ${itemCount}`,
              `totalRecords: ${totalRecords}`,
              `Match: ${itemCount} === ${totalRecords}`,
              chainEnabled ? `Chain: initialScreenSize stored for ${env}/${country}/${store}` : 'Chain: disabled (missing PUT/POST datasets)',
            ].join('\n'),
            contentType: 'text/plain',
          });
        });
      }
    }
  }
});
