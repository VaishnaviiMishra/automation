#!/usr/bin/env node
/**
 * Send a one-line test Adaptive Card to TEAMS_WEBHOOK_URL (from .env).
 * Usage: node scripts/verify-teams-webhook.mjs
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const webhook = process.env.TEAMS_WEBHOOK_URL?.trim();
if (!webhook) {
  console.error('[ERROR] TEAMS_WEBHOOK_URL is not set in .env');
  process.exit(2);
}

const payload = {
  type: 'message',
  attachments: [
    {
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: '✅ Loanwalk API — Teams webhook test',
            weight: 'Bolder',
            wrap: true,
          },
          {
            type: 'TextBlock',
            text: 'If you see this card, TEAMS_WEBHOOK_URL is configured correctly.',
            isSubtle: true,
            wrap: true,
          },
        ],
      },
    },
  ],
};

const res = await fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const text = await res.text().catch(() => '');

if (!res.ok && res.status !== 202) {
  console.error(`[ERROR] Webhook HTTP ${res.status}: ${text.slice(0, 300)}`);
  process.exit(1);
}

console.log('[OK] Test card posted to Teams.');
