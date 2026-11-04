import { test, expect } from '@playwright/test';
import {
  createTestContext,
  datasetExists,
  resolveCountriesForPilot,
  resolveEnvsForPilot,
  resolveStoresForPilot,
} from '../../utils/testContext';
import {
  assertDropPriceForScreen,
  assertScreenSizeReadable,
  decideScreenSizeUpdate,
  fetchContractsFromGet,
  readScreenForFlowItem,
  readScreenSizeFromGet,
  readUpdatedScreenSizeFromPost,
  reviewStamps,
  type ReviewedItem,
  type UpdateDataset,
} from './helpers/loanwalkReview';

const GET_ENDPOINT_KEY = 'getContractsByType' as const;
const PUT_ENDPOINT_KEY = 'putUpdateReviewedItems' as const;
const POST_ENDPOINT_KEY = 'postReviewedItemPriceDrop' as const;
const GET_DATA_KEY = 'loanwalk/getContractsByType';
const PUT_DATA_KEY = 'loanwalk/putUpdateReviewedItems';
const POST_PARAMS_KEY = 'loanwalk/postReviewedItemPriceDrop';

const PILOT_ENVS = ['stg'];
const PILOT_COUNTRIES = ['usa'];
const STORE_MAP: Record<string, string[]> = {
  usa: ['23005'],
};

/** In-memory handoff between serial tests in this file (no chain file). */
type GmwalkShared = {
  initialScreenSize: string;
  updatedScreenSize: string;
};

test.describe('GMwalk — loanwalk API flow', () => {
  for (const env of resolveEnvsForPilot(PILOT_ENVS)) {
    for (const country of resolveCountriesForPilot(PILOT_COUNTRIES)) {
      for (const store of resolveStoresForPilot(STORE_MAP[country] ?? [])) {
        if (!datasetExists({ env, country, store, dataKey: GET_DATA_KEY })) continue;
        if (!datasetExists({ env, country, store, dataKey: PUT_DATA_KEY })) continue;
        if (!datasetExists({ env, country, store, dataKey: POST_PARAMS_KEY })) continue;

        test.describe(`ENV=${env} COUNTRY=${country} STORE=${store}`, () => {
          test.describe.configure({ mode: 'serial', timeout: 180_000 });

          const shared: GmwalkShared = {
            initialScreenSize: '',
            updatedScreenSize: '',
          };

          // ─── Step 1 — GET: contracts list count ──────────────────────────────────
          test('Step 1 — GET — contracts count matches pageable.totalRecords', async ({ request }, testInfo) => {
            const ctx = createTestContext({ env, country, store });
            const params = ctx.params(GET_ENDPOINT_KEY);
            const getUrl = ctx.url(GET_ENDPOINT_KEY);
            const headers = ctx.headers;

            const response = await request.get(getUrl, { headers });
            const responseData = await response.json();
            const contracts = responseData?.payload?.contracts;
            const totalRecords = responseData?.pageable?.totalRecords;
            const itemCount = Array.isArray(contracts) ? contracts.length : -1;

            await testInfo.attach('Request URL', { body: getUrl, contentType: 'text/plain' });
            await testInfo.attach('pageable', {
              body: JSON.stringify(responseData?.pageable ?? null, null, 2),
              contentType: 'application/json',
            });

            expect(response.status()).toBe(200);
            expect(Array.isArray(contracts)).toBe(true);
            expect(typeof totalRecords).toBe('number');
            expect(itemCount).toBe(totalRecords);

            await testInfo.attach('Required Attributes Validated ✅', {
              body: [
                'GMwalk Step 1 — GET (contracts count):',
                '✅ HTTP 200',
                `✅ payload.contracts length === pageable.totalRecords (${itemCount})`,
              ].join('\n'),
              contentType: 'text/plain',
            });

            await testInfo.attach('Validation Summary', {
              body: [
                'Scenario: Step 1 — GET — contract list count',
                `ENV: ${env}`,
                `Store: ${params.storeId}`,
                `contractType: ${params.contractType}`,
                `fromDate: ${params.fromDate}`,
                `toDate: ${params.toDate}`,
                `pageNo: ${params.pageNo}`,
                `pageSize: ${params.pageSize}`,
                `Items counted: ${itemCount}`,
                `totalRecords: ${totalRecords}`,
              ].join('\n'),
              contentType: 'text/plain',
            });
          });

          // ─── Step 2 — GET: screen size for flow item ─────────────────────────────
          test('Step 2 — GET — read current screen size for review item', async ({ request }, testInfo) => {
            const ctx = createTestContext({ env, country, store });
            const flow = ctx.data<UpdateDataset>(PUT_DATA_KEY);
            const getUrl = ctx.url(GET_ENDPOINT_KEY);
            const headers = ctx.headers;

            const { httpStatus, contracts } = await fetchContractsFromGet(request, getUrl, headers);
            expect(httpStatus).toBe(200);

            const screenHit = readScreenSizeFromGet(
              contracts,
              flow.contractEzId,
              flow.itemEzId,
              flow.screenSizeAttributeKey
            );
            assertScreenSizeReadable(screenHit, flow);

            shared.initialScreenSize = screenHit.current;
            expect(shared.initialScreenSize).toMatch(/^(13|15)$/);

            await testInfo.attach('Target contract / item', {
              body: `contractEzId: ${flow.contractEzId}\nitemEzId: ${flow.itemEzId}`,
              contentType: 'text/plain',
            });
            await testInfo.attach('Screen size (GET)', {
              body: `current: ${screenHit.current} (${screenHit.source})`,
              contentType: 'text/plain',
            });

            await testInfo.attach('Required Attributes Validated ✅', {
              body: [
                'GMwalk Step 2 — GET (screen size):',
                `✅ Screen size ${shared.initialScreenSize} on target item`,
                '✅ Value is 13 or 15 (toggleable in PUT)',
              ].join('\n'),
              contentType: 'text/plain',
            });

            await testInfo.attach('Validation Summary', {
              body: [
                'Scenario: Step 2 — GET — screen size for PUT/POST',
                `ENV: ${env}`,
                `contractEzId: ${flow.contractEzId}`,
                `itemEzId: ${flow.itemEzId}`,
                `attribute: ${flow.screenSizeAttributeKey}`,
                `initialScreenSize: ${shared.initialScreenSize}`,
                `source: ${screenHit.source}`,
              ].join('\n'),
              contentType: 'text/plain',
            });
          });

          // ─── Step 3 — PUT: toggle screen size ──────────────────────────────────
          test('Step 3 — PUT — update reviewed item screen size', async ({ request }, testInfo) => {
            expect(shared.initialScreenSize, 'Step 2 must pass before Step 3 PUT').toBeTruthy();

            const ctx = createTestContext({ env, country, store });
            const flow = ctx.data<UpdateDataset>(PUT_DATA_KEY);
            const getUrl = ctx.url(GET_ENDPOINT_KEY);
            const putUrl = ctx.url(PUT_ENDPOINT_KEY);
            const getHeaders = ctx.headers;
            const putHeaders = { ...(flow.putHeaders ?? {}), 'api-key': ctx.headers['api-key'] };

            const decision = decideScreenSizeUpdate(shared.initialScreenSize);
            expect(decision).toBeDefined();
            expect(decision!.oldVal).toBe(shared.initialScreenSize);

            const stamps = reviewStamps();
            const putBody = structuredClone(flow.request);
            const feature = putBody.item.itemChanges.features[0];
            feature.oldVal = decision!.oldVal;
            feature.newVal = decision!.newVal;
            putBody.item.reviewedDttmLocation = stamps.location;
            putBody.item.reviewedDttmUTC = stamps.utc;
            putBody.item.itemChanges.scanDttm = stamps.utc;
            putBody.item.itemChanges.dmwalkDttm = stamps.utc;
            putBody.item.itemChanges.comments[0].createdOn = stamps.utc;
            putBody.item.itemChanges.comments[0].comments =
              `Screen size corrected from ${decision!.oldVal} to ${decision!.newVal}`;

            shared.updatedScreenSize = decision!.newVal;

            await testInfo.attach('PUT body', {
              body: JSON.stringify(putBody, null, 2),
              contentType: 'application/json',
            });

            const putRes = await request.put(putUrl, { headers: putHeaders, data: putBody });
            expect(putRes.status()).toBe(200);
            expect(feature.newVal).toBe(shared.updatedScreenSize);

            const { httpStatus, contracts } = await fetchContractsFromGet(request, getUrl, getHeaders);
            expect(httpStatus).toBe(200);
            const afterHit = readScreenForFlowItem(contracts, flow);
            assertScreenSizeReadable(afterHit, flow);
            expect(afterHit!.current).toBe(shared.updatedScreenSize);

            await testInfo.attach('GET after PUT — screen', {
              body: `current: ${afterHit!.current} (expected ${shared.updatedScreenSize})`,
              contentType: 'text/plain',
            });

            await testInfo.attach('Required Attributes Validated ✅', {
              body: [
                'GMwalk Step 3 — PUT (update reviewed items):',
                `✅ Used GET screen ${shared.initialScreenSize}`,
                `✅ PUT ${decision!.oldVal} → ${decision!.newVal}`,
                `✅ Follow-up GET shows screen ${shared.updatedScreenSize}`,
              ].join('\n'),
              contentType: 'text/plain',
            });

            await testInfo.attach('Validation Summary', {
              body: [
                'Scenario: Step 3 — PUT — screen size toggle',
                `ENV: ${env}`,
                `contractEzId: ${flow.contractEzId}`,
                `itemEzId: ${flow.itemEzId}`,
                `Screen before: ${shared.initialScreenSize}`,
                `Screen after: ${shared.updatedScreenSize}`,
                `PUT status: ${putRes.status()}`,
              ].join('\n'),
              contentType: 'text/plain',
            });
          });

          // ─── Step 4 — POST: drop price + screen on response ────────────────────
          test('Step 4 — POST — drop price for updated screen size', async ({ request }, testInfo) => {
            expect(shared.initialScreenSize, 'Steps 1–2 must pass before Step 4 POST').toBeTruthy();
            expect(shared.updatedScreenSize, 'Step 3 PUT must pass before Step 4 POST').toBeTruthy();

            const ctx = createTestContext({ env, country, store });
            const flow = ctx.data<UpdateDataset>(PUT_DATA_KEY);
            const postUrl = ctx.url(POST_ENDPOINT_KEY);
            const postHeaders = { ...ctx.headers, ...(flow.post.headers ?? {}) };
            const storeId = String(flow.storeId ?? store);
            const attributeKey = flow.screenSizeAttributeKey;
            const postBody = {
              loanEzIds: [flow.contractEzId],
              requireDropPrice: flow.post.requireDropPrice,
            };

            await testInfo.attach('POST body', {
              body: JSON.stringify(postBody, null, 2),
              contentType: 'application/json',
            });

            const postRes = await request.post(postUrl, { headers: postHeaders, data: postBody });
            const postJson = await postRes.json();
            const items = (postJson?.payload?.reviewedItems ?? []) as ReviewedItem[];

            expect(postRes.status()).toBe(200);
            expect(items.length).toBeGreaterThan(0);

            const item = items[0];
            const screenFromResponse = readUpdatedScreenSizeFromPost(item, attributeKey);

            expect(screenFromResponse).toBe(shared.updatedScreenSize);
            expect(screenFromResponse).not.toBe(shared.initialScreenSize);

            assertDropPriceForScreen(
              item,
              shared.updatedScreenSize,
              flow.expectedDropPriceByScreenSize,
              storeId,
              postBody.loanEzIds
            );

            await testInfo.attach('POST response — features', {
              body: JSON.stringify(item.itemChanges?.features ?? null, null, 2),
              contentType: 'application/json',
            });

            await testInfo.attach('Required Attributes Validated ✅', {
              body: [
                'GMwalk Step 4 — POST (reviewed item price drop):',
                `✅ Response newVal ${screenFromResponse} === PUT screen ${shared.updatedScreenSize}`,
                `✅ Response newVal ≠ GET screen ${shared.initialScreenSize}`,
                `✅ dropPrice for screen ${shared.updatedScreenSize}`,
              ].join('\n'),
              contentType: 'text/plain',
            });

            await testInfo.attach('Validation Summary', {
              body: [
                'Scenario: Step 4 — POST — drop price after screen update',
                `ENV: ${env}`,
                `Store: ${storeId}`,
                `contractEzId: ${flow.contractEzId}`,
                `GET screen: ${shared.initialScreenSize}`,
                `PUT screen: ${shared.updatedScreenSize}`,
                `POST feature newVal: ${screenFromResponse}`,
                `POST dropPrice: ${item.dropPrice}`,
                `Expected dropPrice: ${flow.expectedDropPriceByScreenSize[shared.updatedScreenSize]}`,
              ].join('\n'),
              contentType: 'text/plain',
            });
          });
        });
      }
    }
  }
});
