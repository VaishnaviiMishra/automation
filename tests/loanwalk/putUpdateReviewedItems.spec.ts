import { test, expect } from '@playwright/test';
import {
  createTestContext,
  datasetExists,
  resolveCountriesForPilot,
  resolveEnvsForPilot,
  resolveStoresForPilot,
} from '../../utils/testContext';

const GET_ENDPOINT_KEY = 'getContractsByType' as const;
const PUT_ENDPOINT_KEY = 'putUpdateReviewedItems' as const;
const GET_DATA_KEY = 'loanwalk/getContractsByType';
const PUT_DATA_KEY = 'loanwalk/putUpdateReviewedItems';

const PILOT_ENVS = ['stg'];
const PILOT_COUNTRIES = ['usa'];
const STORE_MAP: Record<string, string[]> = {
  usa: ['23005'],
};

type Feature = {
  attributeKey?: string;
  attributeName?: string;
  attributeValue?: string | number | null;
  newVal?: string | number | null;
  oldVal?: string | number | null;
};

type ContractItem = {
  ezId?: string;
  inventoryItem?: { ezid?: string; features?: Feature[] | null } | null;
  review?: { itemChanges?: { features?: Feature[] | null } | null } | null;
};

type LoanContract = {
  contractEzId?: string;
  items?: ContractItem[];
};

type UpdateDataset = {
  contractEzId: string;
  itemEzId: string;
  screenSizeAttributeKey: string;
  screenSizeValues: [string, string];
  headers?: Record<string, string>;
  request: {
    cartContext: { employeeEzId: string; locationEzId: string };
    item: {
      reviewedDttmLocation: string;
      reviewedDttmUTC: string;
      itemChanges: {
        features: Feature[];
        comments: Array<{ createdOn: string; comments: string }>;
        scanDttm: string;
        dmwalkDttm: string;
      };
    };
  };
};

type ScreenSizeHit = {
  /** Size the next PUT should treat as current. A reviewed newVal wins over the original inventory value. */
  current: string;
  source: string;
  itemEzId: string;
  inventoryValue?: string;
  reviewValue?: string;
};

type ScreenSizeUpdate = {
  oldVal: string;
  newVal: string;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatClock(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/** Location clock in the sample is 5 hours behind the UTC stamp. */
function reviewStamps(now = new Date()): { location: string; utc: string } {
  return {
    utc: formatClock(now),
    location: formatClock(new Date(now.getTime() - 5 * 60 * 60 * 1000)),
  };
}

function featureValue(features: Feature[] | null | undefined, attributeKey: string, field: 'attributeValue' | 'newVal'): string | undefined {
  if (!Array.isArray(features)) return undefined;
  const feature = features.find(
    (entry) => entry.attributeKey === attributeKey || entry.attributeName === attributeKey
  );
  const raw = feature?.[field];
  if (raw === undefined || raw === null || raw === '') return undefined;
  return String(raw);
}

function readScreenSize(
  contracts: LoanContract[],
  contractEzId: string,
  itemEzId: string,
  attributeKey: string
): ScreenSizeHit | undefined {
  const contract = contracts.find((entry) => String(entry.contractEzId) === contractEzId);
  if (!contract) return undefined;

  const items = contract.items ?? [];
  const ordered = [
    ...items.filter((item) => String(item.ezId ?? item.inventoryItem?.ezid ?? '') === itemEzId),
    ...items.filter((item) => String(item.ezId ?? item.inventoryItem?.ezid ?? '') !== itemEzId),
  ];

  for (const item of ordered) {
    const id = String(item.ezId ?? item.inventoryItem?.ezid ?? '');
    const inventoryValue = featureValue(item.inventoryItem?.features, attributeKey, 'attributeValue');
    const reviewValue = featureValue(item.review?.itemChanges?.features, attributeKey, 'newVal');
    const current = reviewValue ?? inventoryValue;
    if (!current) continue;
    return {
      current,
      inventoryValue,
      reviewValue,
      itemEzId: id,
      source: reviewValue ? 'review.itemChanges.features.newVal' : 'inventoryItem.features.attributeValue',
    };
  }
  return undefined;
}

/** 13 becomes 15, and 15 becomes 13. Anything else cannot be updated by this use case. */
function decideScreenSizeUpdate(current: string): ScreenSizeUpdate | undefined {
  if (current === '13') return { oldVal: '13', newVal: '15' };
  if (current === '15') return { oldVal: '15', newVal: '13' };
  return undefined;
}

test.describe('Loanwalk Update Reviewed Item Screen Size', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const env of resolveEnvsForPilot(PILOT_ENVS)) {
    for (const country of resolveCountriesForPilot(PILOT_COUNTRIES)) {
      for (const store of resolveStoresForPilot(STORE_MAP[country] ?? [])) {
        if (!datasetExists({ env, country, store, dataKey: GET_DATA_KEY })) continue;
        if (!datasetExists({ env, country, store, dataKey: PUT_DATA_KEY })) continue;

        test(`PUT screen size toggles between 13 and 15 — ENV=${env} COUNTRY=${country} STORE=${store}`, async ({ request }, testInfo) => {
          const ctx = createTestContext({ env, country, store });
          const dataset = ctx.data<UpdateDataset>(PUT_DATA_KEY);
          const getUrl = ctx.url(GET_ENDPOINT_KEY);
          const putUrl = ctx.url(PUT_ENDPOINT_KEY);
          const getHeaders = ctx.headers;
          const putHeaders = { ...(dataset.headers ?? {}), 'api-key': ctx.headers['api-key'] };
          const attributeKey = dataset.screenSizeAttributeKey;
          const contractEzId = dataset.contractEzId;
          const itemEzId = dataset.itemEzId;

          const beforeResponse = await request.get(getUrl, { headers: getHeaders });
          const beforeBody = await beforeResponse.json();
          const beforeContracts = (beforeBody?.payload?.contracts ?? []) as LoanContract[];
          const before = readScreenSize(beforeContracts, contractEzId, itemEzId, attributeKey);

          await testInfo.attach('GET before — request URL', { body: getUrl, contentType: 'text/plain' });
          await testInfo.attach('GET before — screen size', {
            body: before
              ? [
                  `contractEzId ${contractEzId}`,
                  `itemEzId ${before.itemEzId}`,
                  `inventory attributeValue: ${before.inventoryValue ?? 'none'}`,
                  `review newVal: ${before.reviewValue ?? 'none'}`,
                  `current used for the update: ${before.current} (${before.source})`,
                ].join('\n')
              : `contractEzId ${contractEzId} was not found or has no ${attributeKey}`,
            contentType: 'text/plain',
          });

          if (beforeResponse.status() !== 200) {
            throw new Error(
              `Test Failed: The first GET did not return 200.\n` +
                `Expected: 200 OK\n` +
                `Received: ${beforeResponse.status()}\n` +
                `What should have been: GET contracts by type should return the current screen size for contract ${contractEzId}.`
            );
          }

          await test.step('GET current screen size for the contract', async () => {
            expect(beforeResponse.status()).toBe(200);
            expect(before?.current).toBeTruthy();
          });

          const decision = before ? decideScreenSizeUpdate(before.current) : undefined;
          if (!before || !decision) {
            throw new Error(
              `Test Failed: Current screen size cannot be toggled.\n` +
                `Expected: ${attributeKey} is 13 or 15 on contract ${contractEzId}\n` +
                `Received: ${before?.current ?? 'not found'}\n` +
                `What should have been: 13 is updated to 15, and 15 is updated to 13.`
            );
          }

          await testInfo.attach('Update decision', {
            body: [
              `First GET current screen size: ${before.current}`,
              before.current === '13'
                ? 'Decision: current is 13, so PUT newVal 15 and the second GET must be 15'
                : 'Decision: current is 15, so PUT newVal 13 and the second GET must be 13',
              `oldVal: ${decision.oldVal}`,
              `newVal: ${decision.newVal}`,
            ].join('\n'),
            contentType: 'text/plain',
          });

          const stamps = reviewStamps();
          const requestBody = structuredClone(dataset.request);
          const feature = requestBody.item.itemChanges.features[0];
          feature.oldVal = decision.oldVal;
          feature.newVal = decision.newVal;
          requestBody.item.reviewedDttmLocation = stamps.location;
          requestBody.item.reviewedDttmUTC = stamps.utc;
          requestBody.item.itemChanges.scanDttm = stamps.utc;
          requestBody.item.itemChanges.dmwalkDttm = stamps.utc;
          const comment = requestBody.item.itemChanges.comments[0];
          comment.createdOn = stamps.utc;
          comment.comments = `Screen size corrected from ${decision.oldVal} to ${decision.newVal}`;

          await testInfo.attach('PUT request body', {
            body: JSON.stringify(requestBody, null, 2),
            contentType: 'application/json',
          });
          await testInfo.attach('PUT request headers', {
            body: JSON.stringify({ ...putHeaders, 'api-key': '***' }, null, 2),
            contentType: 'application/json',
          });

          const putResponse = await request.put(putUrl, { headers: putHeaders, data: requestBody });
          const putBody = await putResponse.json().catch(() => null);
          await testInfo.attach('PUT response', {
            body: JSON.stringify({ status: putResponse.status(), body: putBody }, null, 2),
            contentType: 'application/json',
          });

          if (putResponse.status() !== 200) {
            throw new Error(
              `Test Failed: PUT reviewed items did not return 200.\n` +
                `Expected: 200 OK updating screen size ${decision.oldVal} → ${decision.newVal}\n` +
                `Received: ${putResponse.status()}\n` +
                `What should have been: The review update should accept the toggled screen size.`
            );
          }

          await test.step(`PUT screen size from ${decision.oldVal} to ${decision.newVal}`, async () => {
            expect(putResponse.status()).toBe(200);
          });

          const afterResponse = await request.get(getUrl, { headers: getHeaders });
          const afterBody = await afterResponse.json();
          const afterContracts = (afterBody?.payload?.contracts ?? []) as LoanContract[];
          const after = readScreenSize(afterContracts, contractEzId, itemEzId, attributeKey);

          await testInfo.attach('GET after — screen size', {
            body: after
              ? [
                  `contractEzId ${contractEzId}`,
                  `itemEzId ${after.itemEzId}`,
                  `inventory attributeValue: ${after.inventoryValue ?? 'none'}`,
                  `review newVal: ${after.reviewValue ?? 'none'}`,
                  `current after update: ${after.current} (${after.source})`,
                  `expected: ${decision.newVal}`,
                ].join('\n')
              : `contractEzId ${contractEzId} was not found or has no ${attributeKey}`,
            contentType: 'text/plain',
          });

          if (afterResponse.status() !== 200 || after?.current !== decision.newVal) {
            throw new Error(
              `Test Failed: Screen size did not update on the follow-up GET.\n` +
                `Expected: ${attributeKey} ${decision.newVal} on contract ${contractEzId}\n` +
                `Received: status ${afterResponse.status()}, screen size ${after?.current ?? 'not found'} (before was ${decision.oldVal}, review newVal ${after?.reviewValue ?? 'none'}, inventory ${after?.inventoryValue ?? 'none'})\n` +
                `What should have been: First GET ${decision.oldVal} means the PUT writes ${decision.newVal} and the second GET returns ${decision.newVal}.`
            );
          }

          await test.step(`GET again and confirm the screen size is ${decision.newVal}`, async () => {
            expect(after.current).toBe(decision.newVal);
          });

          await testInfo.attach('Required Attributes Validated ✅', {
            body: [
              'Use case checks for GET → PUT → GET screen size:',
              `✅ First GET current screen size is ${decision.oldVal}`,
              `✅ Decision: ${decision.oldVal} updates to ${decision.newVal}`,
              `✅ PUT returned 200`,
              `✅ Second GET screen size is ${after.current}`,
            ].join('\n'),
            contentType: 'text/plain',
          });

          await testInfo.attach('Validation Summary', {
            body: [
              `ENV: ${env}`,
              `Country: ${country}`,
              `Store: ${store}`,
              `contractEzId: ${contractEzId}`,
              `itemEzId: ${itemEzId}`,
              `attribute: ${attributeKey}`,
              `Before current: ${before.current} (${before.source})`,
              `Decision: ${decision.oldVal} → ${decision.newVal}`,
              `After current: ${after.current} (${after.source})`,
              `Match: second GET is ${decision.newVal}`,
            ].join('\n'),
            contentType: 'text/plain',
          });
        });
      }
    }
  }
});
