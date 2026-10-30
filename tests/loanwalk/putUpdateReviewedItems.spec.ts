import { test, expect } from '@playwright/test';
import {
  createTestContext,
  datasetExists,
  resolveCountriesForPilot,
  resolveEnvsForPilot,
  resolveStoresForPilot,
} from '../../utils/testContext';

const GET_ENDPOINT_KEY = 'getContractsByType' as const;
const POST_ENDPOINT_KEY = 'postReviewedItemPriceDrop' as const;
const PUT_ENDPOINT_KEY = 'putUpdateReviewedItems' as const;
const GET_DATA_KEY = 'loanwalk/getContractsByType';
const POST_DATA_KEY = 'loanwalk/postReviewedItemPriceDrop';
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

type ReviewBlock = {
  reviewDttm?: string | null;
  itemChanges?: {
    features?: Feature[] | null;
    comments?: Array<{ createdOn?: string | null }> | null;
    scanDttm?: string | null;
    dmwalkDttm?: string | null;
  } | null;
};

type ContractItem = {
  ezId?: string;
  inventoryItem?: { ezid?: string; features?: Feature[] | null } | null;
  review?: ReviewBlock | null;
};

type LoanContract = {
  contractEzId?: string;
  items?: ContractItem[];
};

type PostPriceDropDataset = {
  storeId: string;
  headers?: Record<string, string>;
  request: {
    loanEzIds: string[];
    requireDropPrice: boolean;
  };
};

type UpdateDataset = {
  contractEzId: string;
  itemEzId: string;
  screenSizeAttributeKey: string;
  screenSizeValues: [string, string];
  expectedDropPriceByScreenSize: Record<string, number>;
  headers?: Record<string, string>;
  request: {
    cartContext: { employeeEzId: string; locationEzId: string };
    item: {
      reviewedDttmLocation: string;
      reviewedDttmUTC: string;
      itemChanges: {
        features: Feature[];
        comments: Array<{ createdOn: string; comments: string; type?: string; commentedBy?: number }>;
        scanDttm: string;
        dmwalkDttm: string;
      };
    };
  };
};

type ReviewedItem = {
  contractEzId?: string;
  locationEzId?: string;
  reviewDttm?: string | null;
  originalPrice?: number | null;
  dropPrice?: number | null;
  itemChanges?: {
    comments?: Array<{ createdOn?: string | null }> | null;
    scanDttm?: string | null;
    dmwalkDttm?: string | null;
  } | null;
};

type ScreenSizeHit = {
  current: string;
  source: string;
  itemEzId: string;
  inventoryValue?: string;
  reviewValue?: string;
};

type ReviewTimes = {
  reviewDttm?: string;
  createdOn?: string;
  scanDttm?: string;
  dmwalkDttm?: string;
};

type ScreenSizeUpdate = {
  oldVal: string;
  newVal: string;
};

type FlowStamps = {
  utc: string;
  location: string;
  instant: Date;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatUtcClock(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function formatLocationClock(date: Date): string {
  return formatUtcClock(new Date(date.getTime() - 5 * 60 * 60 * 1000));
}

function reviewStamps(now = new Date()): FlowStamps {
  return { instant: now, utc: formatUtcClock(now), location: formatLocationClock(now) };
}

/**
 * Normalize review timestamps to UTC epoch ms.
 * PUT stamps and API strings without an offset are treated as UTC wall clock (not local TZ).
 */
function parseReviewTimeToUtcMs(value: string): number | undefined {
  const trimmed = value.trim();

  const dashSpace = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (dashSpace) {
    const [, yyyy, mm, dd, hh, min, sec] = dashSpace;
    return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(sec));
  }

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (slash) {
    const [, mm, dd, yyyy, hh, min, sec] = slash;
    return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(sec));
  }

  const isoNoOffset = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (isoNoOffset) {
    const [, yyyy, mm, dd, hh, min, sec] = isoNoOffset;
    return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(sec));
  }

  const withOffset = trimmed.replace(/(\+\d{4})$/, '+00:00');
  const parsed = Date.parse(withOffset);
  if (!Number.isNaN(parsed)) return parsed;

  return undefined;
}

function sameReviewMinute(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ams = parseReviewTimeToUtcMs(a);
  const bms = parseReviewTimeToUtcMs(b);
  if (ams === undefined || bms === undefined) return false;
  return Math.abs(ams - bms) <= 60_000;
}

function featureValue(
  features: Feature[] | null | undefined,
  attributeKey: string,
  field: 'attributeValue' | 'newVal'
): string | undefined {
  if (!Array.isArray(features)) return undefined;
  const feature = features.find(
    (entry) => entry.attributeKey === attributeKey || entry.attributeName === attributeKey
  );
  const raw = feature?.[field];
  if (raw === undefined || raw === null || raw === '') return undefined;
  return String(raw);
}

function findContractItem(
  contracts: LoanContract[],
  contractEzId: string,
  itemEzId: string
): ContractItem | undefined {
  const contract = contracts.find((entry) => String(entry.contractEzId) === contractEzId);
  if (!contract) return undefined;
  return contract.items?.find(
    (item) => String(item.ezId ?? item.inventoryItem?.ezid ?? '') === itemEzId
  );
}

function readScreenSize(
  contracts: LoanContract[],
  contractEzId: string,
  itemEzId: string,
  attributeKey: string
): ScreenSizeHit | undefined {
  const item = findContractItem(contracts, contractEzId, itemEzId);
  if (!item) return undefined;

  const id = String(item.ezId ?? item.inventoryItem?.ezid ?? '');
  const inventoryValue = featureValue(item.inventoryItem?.features, attributeKey, 'attributeValue');
  const reviewValue = featureValue(item.review?.itemChanges?.features, attributeKey, 'newVal');
  const current = reviewValue ?? inventoryValue;
  if (!current) return undefined;

  return {
    current,
    inventoryValue,
    reviewValue,
    itemEzId: id,
    source: reviewValue ? 'review.itemChanges.features.newVal' : 'inventoryItem.features.attributeValue',
  };
}

function readGetReviewTimes(
  contracts: LoanContract[],
  contractEzId: string,
  itemEzId: string
): ReviewTimes | undefined {
  const item = findContractItem(contracts, contractEzId, itemEzId);
  if (!item?.review) return undefined;
  return {
    reviewDttm: item.review.reviewDttm ?? undefined,
    createdOn: item.review.itemChanges?.comments?.[0]?.createdOn ?? undefined,
    scanDttm: item.review.itemChanges?.scanDttm ?? undefined,
    dmwalkDttm: item.review.itemChanges?.dmwalkDttm ?? undefined,
  };
}

function decideScreenSizeUpdate(current: string): ScreenSizeUpdate | undefined {
  if (current === '13') return { oldVal: '13', newVal: '15' };
  if (current === '15') return { oldVal: '15', newVal: '13' };
  return undefined;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function assertDropPriceForScreen(
  item: ReviewedItem,
  screenSize: string,
  expectedBySize: Record<string, number>,
  storeId: string,
  loanEzIds: string[]
): void {
  const mismatches: string[] = [];
  if (item.locationEzId !== storeId) {
    mismatches.push(`locationEzId ${item.locationEzId ?? 'missing'} !== ${storeId}`);
  }
  if (!item.contractEzId || !loanEzIds.includes(item.contractEzId)) {
    mismatches.push(`contractEzId ${item.contractEzId ?? 'missing'} not in [${loanEzIds.join(', ')}]`);
  }
  const expectedDrop = expectedBySize[screenSize];
  if (expectedDrop === undefined) {
    mismatches.push(`no expectedDropPrice for screen size ${screenSize}`);
  } else if (hasValue(item.originalPrice) && item.dropPrice !== expectedDrop) {
    mismatches.push(
      `dropPrice ${item.dropPrice} !== expected ${expectedDrop} for screen size ${screenSize}`
    );
  } else if (hasValue(item.originalPrice) && !hasValue(item.dropPrice)) {
    mismatches.push(`dropPrice missing while originalPrice is ${item.originalPrice}`);
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Test Failed: POST drop price check failed.\n` +
        `Expected: dropPrice ${expectedDrop} for screen size ${screenSize} when originalPrice is set\n` +
        `Received: ${mismatches.join('; ')}\n` +
        `What should have been: requireDropPrice should return the configured drop price for this screen size.`
    );
  }
}

function assertGetReviewTimesMatchFlow(times: ReviewTimes | undefined, stamps: FlowStamps): void {
  if (!times?.reviewDttm || !times.createdOn) {
    throw new Error(
      `Test Failed: GET review times missing after PUT.\n` +
        `Expected: reviewDttm and comment createdOn on the contract item\n` +
        `Received: reviewDttm ${times?.reviewDttm ?? 'missing'}, createdOn ${times?.createdOn ?? 'missing'}\n` +
        `What should have been: The follow-up GET should expose the review time and comment time from the update.`
    );
  }

  const reviewOk = sameReviewMinute(times.reviewDttm, stamps.utc);
  const createdOk = sameReviewMinute(times.createdOn, stamps.utc);
  if (!reviewOk || !createdOk) {
    throw new Error(
      `Test Failed: GET review times do not match the PUT review instant.\n` +
        `Expected: reviewDttm and createdOn align with PUT UTC ${stamps.utc}\n` +
        `Received: reviewDttm ${times.reviewDttm}, createdOn ${times.createdOn}\n` +
        `What should have been: reviewDttm and comment createdOn should reflect the same review moment sent on the PUT.`
    );
  }
}

function assertPostReviewTimesMatchFlow(item: ReviewedItem, stamps: FlowStamps): void {
  const reviewDttm = item.reviewDttm ?? undefined;
  const createdOn = item.itemChanges?.comments?.[0]?.createdOn ?? undefined;
  const reviewOk = reviewDttm ? sameReviewMinute(reviewDttm, stamps.location) : false;
  const createdOk = createdOn ? sameReviewMinute(createdOn, stamps.utc) : false;

  if (!reviewOk || !createdOk) {
    throw new Error(
      `Test Failed: POST review times do not match the PUT review instant.\n` +
        `Expected: reviewDttm ~ ${stamps.location}, createdOn ~ ${stamps.utc}\n` +
        `Received: reviewDttm ${reviewDttm ?? 'missing'}, createdOn ${createdOn ?? 'missing'}\n` +
        `What should have been: The second POST should return review and comment times from the latest review update.`
    );
  }
}

test.describe('Loanwalk review flow (GET → POST → PUT → GET → POST)', () => {
  test.describe.configure({ timeout: 180_000 });

  for (const env of resolveEnvsForPilot(PILOT_ENVS)) {
    for (const country of resolveCountriesForPilot(PILOT_COUNTRIES)) {
      for (const store of resolveStoresForPilot(STORE_MAP[country] ?? [])) {
        if (!datasetExists({ env, country, store, dataKey: GET_DATA_KEY })) continue;
        if (!datasetExists({ env, country, store, dataKey: POST_DATA_KEY })) continue;
        if (!datasetExists({ env, country, store, dataKey: PUT_DATA_KEY })) continue;

        test(`Review flow — ENV=${env} COUNTRY=${country} STORE=${store}`, async ({ request }, testInfo) => {
          const ctx = createTestContext({ env, country, store });
          const putDataset = ctx.data<UpdateDataset>(PUT_DATA_KEY);
          const postDataset = ctx.data<PostPriceDropDataset>(POST_DATA_KEY);

          const getUrl = ctx.url(GET_ENDPOINT_KEY);
          const postUrl = ctx.url(POST_ENDPOINT_KEY);
          const putUrl = ctx.url(PUT_ENDPOINT_KEY);
          const getHeaders = ctx.headers;
          const postHeaders = { ...ctx.headers, ...(postDataset.headers ?? {}) };
          const putHeaders = { ...(putDataset.headers ?? {}), 'api-key': ctx.headers['api-key'] };

          const contractEzId = putDataset.contractEzId;
          const itemEzId = putDataset.itemEzId;
          const attributeKey = putDataset.screenSizeAttributeKey;
          const storeId = String(postDataset.storeId ?? store);
          const postBodyBase = {
            loanEzIds: [contractEzId],
            requireDropPrice: postDataset.request.requireDropPrice,
          };

          // --- 1) GET contract ---
          const getBeforeRes = await request.get(getUrl, { headers: getHeaders });
          const getBeforeBody = await getBeforeRes.json();
          const beforeContracts = (getBeforeBody?.payload?.contracts ?? []) as LoanContract[];
          const beforeSize = readScreenSize(beforeContracts, contractEzId, itemEzId, attributeKey);
          const beforeTimes = readGetReviewTimes(beforeContracts, contractEzId, itemEzId);

          await testInfo.attach('Step 1 — GET contracts URL', { body: getUrl, contentType: 'text/plain' });
          await testInfo.attach('Step 1 — GET before screen & times', {
            body: [
              `screen: ${beforeSize?.current ?? 'not found'} (${beforeSize?.source ?? ''})`,
              `reviewDttm: ${beforeTimes?.reviewDttm ?? 'none'}`,
              `createdOn: ${beforeTimes?.createdOn ?? 'none'}`,
            ].join('\n'),
            contentType: 'text/plain',
          });

          if (getBeforeRes.status() !== 200 || !beforeSize?.current) {
            throw new Error(
              `Test Failed: First GET could not read the contract screen size.\n` +
                `Expected: 200 and screen size for ${contractEzId}\n` +
                `Received: status ${getBeforeRes.status()}, size ${beforeSize?.current ?? 'missing'}\n` +
                `What should have been: GET contracts by type must return the target loan item.`
            );
          }

          await test.step('GET contract and read current screen size', async () => {
            expect(getBeforeRes.status()).toBe(200);
            expect(beforeSize.current).toMatch(/^(13|15)$/);
          });

          const decision = decideScreenSizeUpdate(beforeSize.current);
          if (!decision) {
            throw new Error(
              `Test Failed: Screen size is not 13 or 15.\n` +
                `Expected: 13 or 15\n` +
                `Received: ${beforeSize.current}\n` +
                `What should have been: Only 13 and 15 are toggled in this flow.`
            );
          }

          // --- 2) POST drop price (before PUT) ---
          const postBeforeRes = await request.post(postUrl, { headers: postHeaders, data: postBodyBase });
          const postBeforeBody = await postBeforeRes.json();
          const postBeforeItems = (postBeforeBody?.payload?.reviewedItems ?? []) as ReviewedItem[];

          await testInfo.attach('Step 2 — POST before body', {
            body: JSON.stringify(postBodyBase, null, 2),
            contentType: 'application/json',
          });

          if (postBeforeRes.status() !== 200 || postBeforeItems.length === 0) {
            throw new Error(
              `Test Failed: First POST reviewed items failed.\n` +
                `Expected: 200 with reviewedItems\n` +
                `Received: status ${postBeforeRes.status()}, count ${postBeforeItems.length}\n` +
                `What should have been: POST by contractEzId should return pricing for the loan.`
            );
          }

          await test.step('POST drop price for current screen size (before PUT)', async () => {
            assertDropPriceForScreen(
              postBeforeItems[0],
              beforeSize.current,
              putDataset.expectedDropPriceByScreenSize,
              storeId,
              postBodyBase.loanEzIds
            );
          });

          // --- 3) PUT toggle screen size ---
          const stamps = reviewStamps();
          const putBody = structuredClone(putDataset.request);
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

          await testInfo.attach('Step 3 — PUT body', {
            body: JSON.stringify(putBody, null, 2),
            contentType: 'application/json',
          });
          await testInfo.attach('Step 3 — review instant', {
            body: `UTC: ${stamps.utc}\nLocation (−5h): ${stamps.location}`,
            contentType: 'text/plain',
          });

          const putRes = await request.put(putUrl, { headers: putHeaders, data: putBody });
          if (putRes.status() !== 200) {
            throw new Error(
              `Test Failed: PUT did not return 200.\n` +
                `Expected: 200 updating ${decision.oldVal} → ${decision.newVal}\n` +
                `Received: ${putRes.status()}\n` +
                `What should have been: PUT should persist the toggled screen size.`
            );
          }

          await test.step(`PUT screen size ${decision.oldVal} → ${decision.newVal}`, async () => {
            expect(putRes.status()).toBe(200);
          });

          // --- 4) GET again (screen + reviewDttm + createdOn) ---
          const getAfterRes = await request.get(getUrl, { headers: getHeaders });
          const getAfterBody = await getAfterRes.json();
          const afterContracts = (getAfterBody?.payload?.contracts ?? []) as LoanContract[];
          const afterSize = readScreenSize(afterContracts, contractEzId, itemEzId, attributeKey);
          const afterTimes = readGetReviewTimes(afterContracts, contractEzId, itemEzId);

          await testInfo.attach('Step 4 — GET after screen & times', {
            body: [
              `screen: ${afterSize?.current ?? 'not found'} (expected ${decision.newVal})`,
              `reviewDttm: ${afterTimes?.reviewDttm ?? 'none'}`,
              `createdOn: ${afterTimes?.createdOn ?? 'none'}`,
              `expected review UTC: ${stamps.utc}`,
            ].join('\n'),
            contentType: 'text/plain',
          });

          if (getAfterRes.status() !== 200 || afterSize?.current !== decision.newVal) {
            throw new Error(
              `Test Failed: Second GET screen size wrong.\n` +
                `Expected: ${decision.newVal}\n` +
                `Received: ${afterSize?.current ?? 'missing'}\n` +
                `What should have been: GET after PUT should show the updated screen size.`
            );
          }

          await test.step('GET again — screen size and review times', async () => {
            expect(afterSize.current).toBe(decision.newVal);
            assertGetReviewTimesMatchFlow(afterTimes, stamps);
          });

          // --- 5) POST drop price again (after screen update) ---
          const postAfterRes = await request.post(postUrl, { headers: postHeaders, data: postBodyBase });
          const postAfterBody = await postAfterRes.json();
          const postAfterItems = (postAfterBody?.payload?.reviewedItems ?? []) as ReviewedItem[];

          await testInfo.attach('Step 5 — POST after response (summary)', {
            body: postAfterItems.length
              ? JSON.stringify(
                  {
                    contractEzId: postAfterItems[0].contractEzId,
                    dropPrice: postAfterItems[0].dropPrice,
                    originalPrice: postAfterItems[0].originalPrice,
                    reviewDttm: postAfterItems[0].reviewDttm,
                    createdOn: postAfterItems[0].itemChanges?.comments?.[0]?.createdOn,
                  },
                  null,
                  2
                )
              : 'No items',
            contentType: 'application/json',
          });

          if (postAfterRes.status() !== 200 || postAfterItems.length === 0) {
            throw new Error(
              `Test Failed: Second POST reviewed items failed.\n` +
                `Expected: 200 with reviewedItems after screen update\n` +
                `Received: status ${postAfterRes.status()}, count ${postAfterItems.length}\n` +
                `What should have been: POST should return drop price for the updated item state.`
            );
          }

          await test.step('POST drop price after screen update + review time check', async () => {
            assertDropPriceForScreen(
              postAfterItems[0],
              decision.newVal,
              putDataset.expectedDropPriceByScreenSize,
              storeId,
              postBodyBase.loanEzIds
            );
            assertPostReviewTimesMatchFlow(postAfterItems[0], stamps);
          });

          await testInfo.attach('Required Attributes Validated ✅', {
            body: [
              'Loanwalk flow GET → POST → PUT → GET → POST:',
              `✅ GET #1 screen size ${beforeSize.current}`,
              `✅ POST #1 dropPrice for screen ${beforeSize.current}`,
              `✅ PUT ${decision.oldVal} → ${decision.newVal} at ${stamps.utc} UTC`,
              `✅ GET #2 screen ${afterSize.current}, reviewDttm & createdOn match PUT`,
              `✅ POST #2 dropPrice for screen ${decision.newVal}, review times match PUT`,
            ].join('\n'),
            contentType: 'text/plain',
          });

          await testInfo.attach('Validation Summary', {
            body: [
              `ENV: ${env}`,
              `Store: ${storeId}`,
              `contractEzId: ${contractEzId}`,
              `itemEzId: ${itemEzId}`,
              `Screen: ${decision.oldVal} → ${decision.newVal}`,
              `Drop price (13): ${putDataset.expectedDropPriceByScreenSize['13']}`,
              `Drop price (15): ${putDataset.expectedDropPriceByScreenSize['15']}`,
              `POST #1 dropPrice: ${postBeforeItems[0].dropPrice}`,
              `POST #2 dropPrice: ${postAfterItems[0].dropPrice}`,
              `PUT review UTC: ${stamps.utc}`,
              `GET #2 reviewDttm: ${afterTimes?.reviewDttm}`,
              `GET #2 createdOn: ${afterTimes?.createdOn}`,
              `POST #2 reviewDttm: ${postAfterItems[0].reviewDttm}`,
              `POST #2 createdOn: ${postAfterItems[0].itemChanges?.comments?.[0]?.createdOn}`,
            ].join('\n'),
            contentType: 'text/plain',
          });
        });
      }
    }
  }
});
