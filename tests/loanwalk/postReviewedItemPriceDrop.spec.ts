import { test, expect } from '@playwright/test';
import {
  createTestContext,
  datasetExists,
  resolveCountriesForPilot,
  resolveEnvsForPilot,
  resolveStoresForPilot,
} from '../../utils/testContext';

const ENDPOINT_KEY = 'postReviewedItemPriceDrop' as const;
const DATA_KEY = 'loanwalk/postReviewedItemPriceDrop';

const PILOT_ENVS = ['stg'];
const PILOT_COUNTRIES = ['usa'];
const STORE_MAP: Record<string, string[]> = {
  usa: ['23005'],
};

type PriceDropDataset = {
  storeId: string;
  headers?: Record<string, string>;
  request: {
    loanEzIds: string[];
    requireDropPrice: boolean;
  };
};

type ReviewedItem = {
  contractEzId?: string;
  locationEzId?: string;
  originalPrice?: number | null;
  dropPrice?: number | null;
};

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

test.describe('Loanwalk Reviewed Item Price Drop', () => {
  test.describe.configure({ timeout: 60_000 });

  for (const env of resolveEnvsForPilot(PILOT_ENVS)) {
    for (const country of resolveCountriesForPilot(PILOT_COUNTRIES)) {
      for (const store of resolveStoresForPilot(STORE_MAP[country] ?? [])) {
        if (!datasetExists({ env, country, store, dataKey: DATA_KEY })) continue;

        test(`POST reviewed item price drop — ENV=${env} COUNTRY=${country} STORE=${store}`, async ({ request }, testInfo) => {
          const ctx = createTestContext({ env, country, store });
          const dataset = ctx.data<PriceDropDataset>(DATA_KEY);
          const params = ctx.params(ENDPOINT_KEY);
          const fullUrl = ctx.url(ENDPOINT_KEY);
          const headers = { ...ctx.headers, ...(dataset.headers ?? {}) };
          const requestBody = dataset.request;
          const expectedStoreId = String(dataset.storeId ?? params.storeId);
          const expectedLoanEzIds = requestBody.loanEzIds ?? [];

          const response = await request.post(fullUrl, { headers, data: requestBody });
          const responseData = await response.json();
          const reviewedItems = (responseData?.payload?.reviewedItems ?? []) as ReviewedItem[];

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
          await testInfo.attach('Request body', {
            body: JSON.stringify(requestBody, null, 2),
            contentType: 'application/json',
          });
          await testInfo.attach('Price check', {
            body: reviewedItems.length
              ? reviewedItems
                  .map(
                    (item, index) =>
                      `#${index + 1} contractEzId=${item.contractEzId ?? ''} locationEzId=${item.locationEzId ?? ''} originalPrice=${item.originalPrice ?? 'null'} dropPrice=${item.dropPrice ?? 'null'}`
                  )
                  .join('\n')
              : 'No reviewed items returned',
            contentType: 'text/plain',
          });

          if (response.status() !== 200) {
            throw new Error(
              `Test Failed: API endpoint responded with an incorrect status code.\n` +
                `Expected: 200 OK\n` +
                `Received: ${response.status()}\n` +
                `What should have been: POST reviewed items for store ${expectedStoreId} should return 200.`
            );
          }

          await test.step('Verify that the API endpoint responds with a 200 OK status', async () => {
            expect(response.status()).toBe(200);
          });

          const paramMismatches: string[] = [];
          if (!responseData?.success) {
            paramMismatches.push(`success was ${responseData?.success}`);
          }
          if (reviewedItems.length === 0) {
            paramMismatches.push('reviewedItems was empty');
          }
          for (const item of reviewedItems) {
            if (item.locationEzId !== expectedStoreId) {
              paramMismatches.push(
                `locationEzId ${item.locationEzId ?? 'missing'} did not match store ${expectedStoreId}`
              );
            }
            if (!item.contractEzId || !expectedLoanEzIds.includes(item.contractEzId)) {
              paramMismatches.push(
                `contractEzId ${item.contractEzId ?? 'missing'} was not in loanEzIds [${expectedLoanEzIds.join(', ')}]`
              );
            }
          }

          if (paramMismatches.length > 0) {
            throw new Error(
              `Test Failed: Response did not match the request params.\n` +
                `Expected: success true, locationEzId ${expectedStoreId}, contractEzId in [${expectedLoanEzIds.join(', ')}]\n` +
                `Received: ${paramMismatches.join('; ')}\n` +
                `What should have been: Each reviewed item should belong to the store and loan sent in the request.`
            );
          }

          await test.step('Verify that reviewed items match the requested store and loanEzIds', async () => {
            expect(paramMismatches).toEqual([]);
          });

          const missingDropPrice = reviewedItems.filter(
            (item) => hasValue(item.originalPrice) && !hasValue(item.dropPrice)
          );

          if (requestBody.requireDropPrice && missingDropPrice.length > 0) {
            const received = missingDropPrice
              .map(
                (item) =>
                  `contractEzId ${item.contractEzId}: originalPrice ${item.originalPrice}, dropPrice ${item.dropPrice ?? 'null'}`
              )
              .join('; ');
            throw new Error(
              `Test Failed: dropPrice is missing where originalPrice has a value.\n` +
                `Expected: dropPrice has a value whenever originalPrice has a value\n` +
                `Received: ${received}\n` +
                `What should have been: requireDropPrice true should return a dropPrice for every item that has an originalPrice.`
            );
          }

          await test.step('Verify that dropPrice has a value when originalPrice does', async () => {
            expect(missingDropPrice).toEqual([]);
          });

          const priceLines = reviewedItems.map(
            (item) =>
              `${item.contractEzId}: originalPrice ${item.originalPrice ?? 'null'}, dropPrice ${item.dropPrice ?? 'null'}`
          );

          await testInfo.attach('Required Attributes Validated ✅', {
            body: [
              'Use case checks for POST reviewed item price drop:',
              '✅ HTTP 200',
              `✅ locationEzId matches store ${expectedStoreId}`,
              `✅ contractEzId matches loanEzIds [${expectedLoanEzIds.join(', ')}]`,
              '✅ dropPrice has a value when originalPrice does',
            ].join('\n'),
            contentType: 'text/plain',
          });

          await testInfo.attach('Validation Summary', {
            body: [
              `ENV: ${env}`,
              `Country: ${country}`,
              `Store: ${expectedStoreId}`,
              `loanEzIds: ${expectedLoanEzIds.join(', ')}`,
              `requireDropPrice: ${requestBody.requireDropPrice}`,
              `Items returned: ${reviewedItems.length}`,
              ...priceLines,
              `Match: dropPrice present for every item with originalPrice`,
            ].join('\n'),
            contentType: 'text/plain',
          });
        });
      }
    }
  }
});
