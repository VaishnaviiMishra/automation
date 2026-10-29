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
  value: string;
  source: string;
  itemEzId: string;
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
    const inventory = featureValue(item.inventoryItem?.features, attributeKey, 'attributeValue');
    if (inventory) {
      return { value: inventory, source: 'inventoryItem.features.attributeValue', itemEzId: id };
    }
    const reviewed = featureValue(item.review?.itemChanges?.features, attributeKey, 'newVal');
    if (reviewed) {
      return { value: reviewed, source: 'review.itemChanges.features.newVal', itemEzId: id };
    }
  }
  return undefined;
}

function alternateValue(current: string, values: [string, string]): string | undefined {
  if (current === values[0]) return values[1];
  if (current === values[1]) return values[0];
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
              ? `contractEzId ${contractEzId}\nitemEzId ${before.itemEzId}\nsource ${before.source}\nscreen size ${before.value}`
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
            expect(before?.value).toBeTruthy();
          });

          const nextValue = before ? alternateValue(before.value, dataset.screenSizeValues) : undefined;
          if (!before || !nextValue) {
            throw new Error(
              `Test Failed: Current screen size cannot be toggled.\n` +
                `Expected: ${attributeKey} is ${dataset.screenSizeValues.join(' or ')} on contract ${contractEzId}\n` +
                `Received: ${before?.value ?? 'not found'}\n` +
                `What should have been: The current value is 13 or 15 so the PUT can switch to the other one.`
            );
          }

          const stamps = reviewStamps();
          const requestBody = structuredClone(dataset.request);
          const feature = requestBody.item.itemChanges.features[0];
          feature.oldVal = before.value;
          feature.newVal = nextValue;
          requestBody.item.reviewedDttmLocation = stamps.location;
          requestBody.item.reviewedDttmUTC = stamps.utc;
          requestBody.item.itemChanges.scanDttm = stamps.utc;
          requestBody.item.itemChanges.dmwalkDttm = stamps.utc;
          const comment = requestBody.item.itemChanges.comments[0];
          comment.createdOn = stamps.utc;
          comment.comments = `Screen size corrected from ${before.value} to ${nextValue}`;

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
                `Expected: 200 OK updating screen size ${before.value} → ${nextValue}\n` +
                `Received: ${putResponse.status()}\n` +
                `What should have been: The review update should accept the toggled screen size.`
            );
          }

          await test.step(`PUT screen size from ${before.value} to ${nextValue}`, async () => {
            expect(putResponse.status()).toBe(200);
          });

          const afterResponse = await request.get(getUrl, { headers: getHeaders });
          const afterBody = await afterResponse.json();
          const afterContracts = (afterBody?.payload?.contracts ?? []) as LoanContract[];
          const after = readScreenSize(afterContracts, contractEzId, itemEzId, attributeKey);

          await testInfo.attach('GET after — screen size', {
            body: after
              ? `contractEzId ${contractEzId}\nitemEzId ${after.itemEzId}\nsource ${after.source}\nscreen size ${after.value}`
              : `contractEzId ${contractEzId} was not found or has no ${attributeKey}`,
            contentType: 'text/plain',
          });

          if (afterResponse.status() !== 200 || after?.value !== nextValue) {
            throw new Error(
              `Test Failed: Screen size did not update on the follow-up GET.\n` +
                `Expected: ${attributeKey} ${nextValue} on contract ${contractEzId}\n` +
                `Received: status ${afterResponse.status()}, screen size ${after?.value ?? 'not found'} (before was ${before.value})\n` +
                `What should have been: The second GET should show the screen size that the PUT just wrote.`
            );
          }

          await test.step('GET again and confirm the screen size changed', async () => {
            expect(after.value).toBe(nextValue);
          });

          await testInfo.attach('Required Attributes Validated ✅', {
            body: [
              'Use case checks for GET → PUT → GET screen size:',
              '✅ First GET returned 200 and the current screen size',
              `✅ PUT sent ${before.value} → ${nextValue} and returned 200`,
              `✅ Second GET screen size is ${after.value}`,
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
              `Before: ${before.value} (${before.source})`,
              `PUT: ${before.value} → ${nextValue}`,
              `After: ${after.value} (${after.source})`,
              `Match: ${before.value} updated to ${after.value}`,
            ].join('\n'),
            contentType: 'text/plain',
          });
        });
      }
    }
  }
});
