import { test, expect } from '@playwright/test';
import {
  createTestContext,
  datasetExists,
  resolveCountriesForPilot,
  resolveEnvsForPilot,
  resolveStoresForPilot,
} from '../../utils/testContext';

const ENDPOINT_KEY = 'getContractsByType' as const;
const DATA_KEY = 'loanwalk/getContractsByType';

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

          await testInfo.attach('Required Attributes Validated ✅', {
            body: [
              'Use case checks for GET contracts by type:',
              '✅ HTTP 200',
              `✅ Item count matches totalRecords (${itemCount} === ${totalRecords})`,
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
            ].join('\n'),
            contentType: 'text/plain',
          });
        });
      }
    }
  }
});
