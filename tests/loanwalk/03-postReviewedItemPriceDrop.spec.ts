import { test, expect } from '@playwright/test';
import {
  createTestContext,
  datasetExists,
  resolveCountriesForPilot,
  resolveEnvsForPilot,
  resolveStoresForPilot,
} from '../../utils/testContext';
import { requireChainAfterPut } from './helpers/loanwalkChainState';
import {
  assertDropPriceForScreen,
  readUpdatedScreenSizeFromPost,
  type ReviewedItem,
  type UpdateDataset,
} from './helpers/loanwalkReview';

const POST_ENDPOINT_KEY = 'postReviewedItemPriceDrop' as const;
const GET_DATA_KEY = 'loanwalk/getContractsByType';
const PUT_DATA_KEY = 'loanwalk/putUpdateReviewedItems';
const POST_PARAMS_KEY = 'loanwalk/postReviewedItemPriceDrop';

const PILOT_ENVS = ['stg'];
const PILOT_COUNTRIES = ['usa'];
const STORE_MAP: Record<string, string[]> = {
  usa: ['23005'],
};

test.describe('Loanwalk POST reviewed item price drop', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  for (const env of resolveEnvsForPilot(PILOT_ENVS)) {
    for (const country of resolveCountriesForPilot(PILOT_COUNTRIES)) {
      for (const store of resolveStoresForPilot(STORE_MAP[country] ?? [])) {
        if (!datasetExists({ env, country, store, dataKey: GET_DATA_KEY })) continue;
        if (!datasetExists({ env, country, store, dataKey: POST_PARAMS_KEY })) continue;
        if (!datasetExists({ env, country, store, dataKey: PUT_DATA_KEY })) continue;

        test(`POST drop price after PUT — ENV=${env} COUNTRY=${country} STORE=${store}`, async ({ request }, testInfo) => {
          const chain = requireChainAfterPut(env, country, store);
          const ctx = createTestContext({ env, country, store });
          const flow = ctx.data<UpdateDataset>(PUT_DATA_KEY);

          const postUrl = ctx.url(POST_ENDPOINT_KEY);
          const postHeaders = { ...ctx.headers, ...(flow.post.headers ?? {}) };
          const storeId = String(flow.storeId ?? store);
          const attributeKey = flow.screenSizeAttributeKey;
          const updatedScreen = chain.updatedScreenSize!;
          const postBody = {
            loanEzIds: [flow.contractEzId],
            requireDropPrice: flow.post.requireDropPrice,
          };

          await testInfo.attach('Chain — expect from PUT', {
            body: [
              `initialScreenSize (GET): ${chain.initialScreenSize}`,
              `updatedScreenSize (PUT): ${updatedScreen}`,
            ].join('\n'),
            contentType: 'text/plain',
          });
          await testInfo.attach('POST body', {
            body: JSON.stringify(postBody, null, 2),
            contentType: 'application/json',
          });

          const postRes = await request.post(postUrl, { headers: postHeaders, data: postBody });
          const postBodyJson = await postRes.json();
          const items = (postBodyJson?.payload?.reviewedItems ?? []) as ReviewedItem[];

          if (postRes.status() !== 200 || items.length === 0) {
            throw new Error(
              `Test Failed: POST reviewed items failed.\n` +
                `Expected: 200 with reviewedItems\n` +
                `Received: status ${postRes.status()}, count ${items.length}\n` +
                `What should have been: POST should return pricing for the loan after PUT.`
            );
          }

          const item = items[0];
          const screenFromResponse = readUpdatedScreenSizeFromPost(item, attributeKey);

          await testInfo.attach('POST response — screen feature', {
            body: JSON.stringify(item.itemChanges?.features ?? null, null, 2),
            contentType: 'application/json',
          });

          await test.step('POST returns updated screen size (newVal), not the pre-PUT value', async () => {
            expect(screenFromResponse).toBeDefined();
            expect(screenFromResponse).toBe(updatedScreen);
            expect(screenFromResponse).not.toBe(chain.initialScreenSize);
          });

          await test.step('POST dropPrice matches expected price for updated screen size', async () => {
            assertDropPriceForScreen(
              item,
              updatedScreen,
              flow.expectedDropPriceByScreenSize,
              storeId,
              postBody.loanEzIds
            );
          });

          await testInfo.attach('Required Attributes Validated ✅', {
            body: [
              'Loanwalk POST (chain step 3):',
              `✅ Response screen newVal ${screenFromResponse} === PUT target ${updatedScreen}`,
              `✅ Response screen is not old GET value ${chain.initialScreenSize}`,
              `✅ dropPrice for screen ${updatedScreen}`,
            ].join('\n'),
            contentType: 'text/plain',
          });

          await testInfo.attach('Validation Summary', {
            body: [
              `ENV: ${env}`,
              `Store: ${storeId}`,
              `contractEzId: ${flow.contractEzId}`,
              `GET screen: ${chain.initialScreenSize}`,
              `PUT screen: ${updatedScreen}`,
              `POST feature newVal: ${screenFromResponse}`,
              `POST dropPrice: ${item.dropPrice}`,
              `Expected dropPrice: ${flow.expectedDropPriceByScreenSize[updatedScreen]}`,
            ].join('\n'),
            contentType: 'text/plain',
          });
        });
      }
    }
  }
});
