/**
 * Custom Playwright → Microsoft Teams Adaptive Card reporter.
 *
 * Posts when TEAMS_NOTIFY=1 and TEAMS_WEBHOOK_URL is set.
 * Card layout:
 *   Loanwalk
 *     🔴 Failed — N  ▼
 *     🟢 Passed — N  ▼
 *   Showcase
 *     🔴 Failed — N  ▼
 *     🟢 Passed — N  ▼
 * Each row: Test | Validation Results (no Pass/Fail column; status is from the section).
 */
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

type RowStatus = 'passed' | 'failed' | 'flaky' | 'skipped';

type TestRow = {
  name: string;
  domain: string;
  status: RowStatus;
  note: string;
};

const MAX_NOTE = 900;
const MAX_ROWS_PER_SECTION = 12;

/** Strip Playwright/terminal ANSI color codes (e.g. [32m200[39m → 200). */
function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\u009b\[[0-9;]*[A-Za-z]/g, '')
    // Some serializers leave the ESC char missing and keep "[32m…[39m"
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\[(?:\d{1,3};)*\d{1,3}m/g, '');
}

function truncate(text: string, limit = MAX_NOTE): string {
  const cleaned = stripAnsi(text).trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - 1)}…`;
}

function shortName(title: string): string {
  return title.replace(/\s*[—\-]\s*ENV\s*=.*$/i, '').trim() || title;
}

function domainFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/loanwalk/')) return 'loanwalk';
  if (normalized.includes('/showcase/')) return 'showcase';
  return 'other';
}

function attachmentText(result: TestResult, nameMatch: RegExp): string | undefined {
  for (const att of result.attachments) {
    if (!nameMatch.test(att.name)) continue;
    if (att.body) {
      return Buffer.from(att.body).toString('utf8').trim();
    }
  }
  return undefined;
}

/** Bold Adaptive Card markdown labels (Teams supports **bold** in TextBlock). */
function boldLabel(line: string, label: RegExp): string {
  return line.replace(label, (match) => `**${match}**`);
}

/** Build compact error summary: Test Failed / Expected / Received / What should have been */
function errorNote(result: TestResult): string {
  const chunks: string[] = [];
  for (const err of result.errors ?? []) {
    if (err.message) chunks.push(err.message);
  }
  if (result.error?.message) chunks.push(result.error.message);

  const raw = stripAnsi(chunks.join('\n'));
  if (!raw.trim()) return 'No error message in report';

  const lines = raw
    .split(/\r?\n/)
    .map((l) => stripAnsi(l).trim())
    .filter(Boolean);

  const pick = (re: RegExp) => lines.find((l) => re.test(l));
  let failed = pick(/^Test Failed:/i);
  let expected = pick(/^Expected:/i);
  let received = pick(/^Received:/i);
  let should = pick(/^What should have been:/i);

  // Playwright expect() often formats as "Expected: …" / "Received: …" without our custom labels
  if (!expected) {
    expected = pick(/^Expected\b/i);
  }
  if (!received) {
    received = pick(/^Received\b/i);
  }

  if (failed || expected || received || should) {
    if (failed) failed = boldLabel(failed, /^Test Failed:/i);
    if (expected) expected = boldLabel(expected, /^Expected:?/i);
    if (received) received = boldLabel(received, /^Received:?/i);
    if (should) should = boldLabel(should, /^What should have been:/i);
    return truncate(
      [failed, expected, received, should].filter(Boolean).join('\n')
    );
  }

  // Fallback: first meaningful lines (skip stack noise)
  const useful = lines.filter(
    (l) =>
      !l.startsWith('at ') &&
      !l.startsWith('>') &&
      !/^Error:\s*$/i.test(l) &&
      !l.includes('node_modules')
  );
  return truncate(useful.slice(0, 6).join('\n') || lines[0]);
}

/** Prefer Required Attributes Validated checklist, else Validation Summary */
function passNote(result: TestResult, title: string, domain: string): string {
  const required = attachmentText(result, /required attributes validated/i);
  if (required) {
    // Drop the intro sentence; keep ✅ checklist lines for the card
    const checks = required
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('✅'));
    if (checks.length > 0) {
      return truncate(checks.join('\n'));
    }
    return truncate(required);
  }

  const summary = attachmentText(result, /validation summary/i);
  if (summary) {
    return truncate(summary);
  }

  return truncate(`Validated ${domain}: ${shortName(title)}`);
}

function classify(test: TestCase, result: TestResult): RowStatus {
  const outcome = test.outcome();
  if (outcome === 'flaky') return 'flaky';
  if (outcome === 'skipped' || result.status === 'skipped' || result.status === 'interrupted') {
    return 'skipped';
  }
  if (outcome === 'unexpected' || result.status === 'failed' || result.status === 'timedOut') {
    return 'failed';
  }
  return 'passed';
}

function tableCell(text: string, bold = false, subtle = false): Record<string, unknown> {
  const block: Record<string, unknown> = {
    type: 'TextBlock',
    text: text || '-',
    wrap: true,
    size: 'Small',
  };
  if (bold) block.weight = 'Bolder';
  if (subtle) block.isSubtle = true;
  return block;
}

function adaptiveTable(rows: TestRow[]): Record<string, unknown>[] {
  const headers: Array<[string, string]> = [
    ['Test', '2'],
    ['Validation Results', '4'],
  ];

  const shown = rows.slice(0, MAX_ROWS_PER_SECTION);
  const extra = rows.length - shown.length;

  const columnSet = (values: string[], header = false): Record<string, unknown> => ({
    type: 'ColumnSet',
    separator: true,
    spacing: 'Small',
    columns: headers.map(([, width], i) => ({
      type: 'Column',
      width,
      items: [tableCell(header ? headers[i][0] : values[i], header, !header)],
    })),
  });

  const items: Record<string, unknown>[] = [
    columnSet(headers.map(([h]) => h), true),
  ];

  for (const row of shown) {
    items.push(columnSet([row.name, row.note]));
  }

  if (extra > 0) {
    items.push({
      type: 'TextBlock',
      text: `+${extra} more not shown`,
      isSubtle: true,
      size: 'Small',
      wrap: true,
    });
  }

  return items;
}

function section(
  id: string,
  summary: string,
  rows: TestRow[],
  startExpanded: boolean
): Record<string, unknown>[] {
  if (rows.length === 0) return [];
  return [
    {
      type: 'Container',
      items: [
        {
          type: 'TextBlock',
          text: summary,
          weight: 'Bolder',
          wrap: true,
        },
      ],
      selectAction: {
        type: 'Action.ToggleVisibility',
        targetElements: [id],
      },
    },
    {
      type: 'Container',
      id,
      isVisible: startExpanded,
      items: adaptiveTable(rows),
    },
  ];
}

const DOMAIN_ORDER = ['loanwalk', 'showcase', 'other'] as const;

const DOMAIN_LABEL: Record<string, string> = {
  loanwalk: 'Loanwalk',
  showcase: 'Showcase',
  other: 'Other',
};

function safeId(parts: string[]): string {
  return parts.join('_').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
}

/** Per-domain Passed / Failed / Flaky / Skipped expandable lists */
function domainSections(domain: string, rows: TestRow[]): Record<string, unknown>[] {
  if (rows.length === 0) return [];

  const passed = rows.filter((r) => r.status === 'passed');
  const failed = rows.filter((r) => r.status === 'failed');
  const flaky = rows.filter((r) => r.status === 'flaky');
  const skipped = rows.filter((r) => r.status === 'skipped');
  const total = rows.length;
  const label = DOMAIN_LABEL[domain] ?? domain;

  const items: Record<string, unknown>[] = [
    {
      type: 'TextBlock',
      text: `${label}  (${passed.length}/${total} passed · ${failed.length}/${total} failed)`,
      weight: 'Bolder',
      size: 'Medium',
      separator: true,
      spacing: 'Medium',
      wrap: true,
    },
    ...section(
      safeId([domain, 'fail']),
      `🔴 Failed — ${failed.length}/${total}  ▼`,
      failed,
      false
    ),
    ...section(
      safeId([domain, 'pass']),
      `🟢 Passed — ${passed.length}/${total}  ▼`,
      passed,
      false
    ),
    ...section(
      safeId([domain, 'flaky']),
      `🟡 Flaky — ${flaky.length}/${total}  ▼`,
      flaky,
      false
    ),
    ...section(
      safeId([domain, 'skip']),
      `⏭️ Skipped — ${skipped.length}/${total}  ▼`,
      skipped,
      false
    ),
  ];

  return items;
}

function cardTitle(): string {
  const env = (process.env.ENV ?? 'qa').toUpperCase();
  const country = (process.env.COUNTRY ?? 'usa').toLowerCase();
  const store = process.env.STORE ?? '23005';
  const countryLabel =
    country === 'mexico' ? 'Mexico' : country === 'usa' ? 'USA' : country.toUpperCase();
  return `EZCorp API — ${countryLabel}: ${store} (${env})`;
}

function isAllowedMatrix(): boolean {
  const env = (process.env.ENV ?? '').toLowerCase();
  const country = (process.env.COUNTRY ?? '').toLowerCase();
  const store = process.env.STORE ?? '';
  if (country === 'usa' && (store === '14401' || store === '23005')) {
    return env === 'qa' || env === 'stg';
  }
  if (country === 'mexico' && store === '85016') {
    return env === 'qa' || env === 'stg';
  }
  return false;
}

function buildPayload(rows: TestRow[], durationMs: number): Record<string, unknown> {
  const passed = rows.filter((r) => r.status === 'passed');
  const failed = rows.filter((r) => r.status === 'failed');
  const flaky = rows.filter((r) => r.status === 'flaky');
  const skipped = rows.filter((r) => r.status === 'skipped');
  const total = rows.length;
  const ok = failed.length === 0;
  const title = cardTitle();

  const seconds = Math.round(durationMs / 1000);
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  const durationStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const body: Record<string, unknown>[] = [
    {
      type: 'TextBlock',
      text: ok ? `✅ ${title}` : `❌ ${title}`,
      weight: 'Bolder',
      size: 'Medium',
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: `${stamp} UTC · ${total} tests · ${durationStr}`,
      isSubtle: true,
      size: 'Small',
      wrap: true,
      spacing: 'None',
    },
    {
      type: 'FactSet',
      facts: [
        { title: 'Passed', value: `${passed.length}/${total}` },
        { title: 'Failed', value: `${failed.length}/${total}` },
        { title: 'Flaky', value: `${flaky.length}/${total}` },
        { title: 'Skipped', value: `${skipped.length}/${total}` },
      ],
    },
  ];

  for (const domain of DOMAIN_ORDER) {
    const domainRows = rows.filter((r) => r.domain === domain);
    body.push(...domainSections(domain, domainRows));
  }

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
        },
      },
    ],
  };
}

async function postWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // Always drain the body so undici closes cleanly on Windows (avoids UV_HANDLE_CLOSING assert).
  const text = await res.text().catch(() => '');
  if (!res.ok && res.status !== 202) {
    throw new Error(`Teams webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

class TeamsDetailReporter implements Reporter {
  private rows: TestRow[] = [];
  private startedAt = 0;
  private debug = false;

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.startedAt = Date.now();
    this.rows = [];
    this.debug = process.env.TEAMS_DEBUG === '1';
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const status = classify(test, result);
    const domain = domainFromPath(test.location.file);
    const name = shortName(test.title);

    let note: string;
    if (status === 'failed') {
      note = errorNote(result);
    } else if (status === 'passed') {
      note = passNote(result, test.title, domain);
    } else if (status === 'flaky') {
      note = errorNote(result);
    } else {
      note = 'Skipped';
    }

    this.rows.push({ name, domain, status, note });

    if (this.debug) {
      console.log(`[teams-detail] ${status.toUpperCase()} ${name}\n${note}`);
    }
  }

  async onEnd(_result: FullResult): Promise<void> {
    const notify = process.env.TEAMS_NOTIFY === '1';
    const webhook = process.env.TEAMS_WEBHOOK_URL?.trim();

    if (!notify) return;
    if (!webhook) {
      console.warn('[teams-detail] TEAMS_WEBHOOK_URL not set; skipping Teams post.');
      return;
    }
    if (!isAllowedMatrix()) {
      console.warn(
        `[teams-detail] Skipping Teams post — unsupported matrix ENV=${process.env.ENV} COUNTRY=${process.env.COUNTRY} STORE=${process.env.STORE}`
      );
      return;
    }
    if (this.rows.length === 0) {
      console.warn('[teams-detail] No tests recorded; skipping Teams post.');
      return;
    }

    const durationMs = Date.now() - this.startedAt;
    const payload = buildPayload(this.rows, durationMs);

    try {
      await postWebhook(webhook, payload);
      console.log('[teams-detail] Posted Adaptive Card to Teams.');
    } catch (err) {
      console.error('[teams-detail] Failed to post to Teams:', err);
    }
  }
}

export default TeamsDetailReporter;
