# Microsoft Teams results (Windows)

Post **Adaptive Cards** after a test run. Uses [`reporters/teamsDetailReporter.ts`](reporters/teamsDetailReporter.ts) when `TEAMS_NOTIFY=1`.

## 1. Create the webhook

1. In **Microsoft Teams**, open the channel for results.
2. **Workflows** (or **Connectors** / **Power Automate**) → **Post to a channel when a webhook request is received**.
3. Copy the **HTTP POST URL**.

## 2. Configure `.env`

In the repo root (do not commit):

```env
STG_SHOWCASE_API_KEY=your-key
TEAMS_WEBHOOK_URL=https://....environment.api.powerplatform.com/...
TEAMS_DEBUG=0
```

Template: [`.env.example`](.env.example).

## 3. Install (once)

From **Command Prompt** or **PowerShell** in the repo root:

```bat
cd C:\path\to\Backendapi
npm install
npx playwright install chromium
```

## 4. Verify the webhook

```bat
npm run teams:verify-webhook
```

A short test card should appear in Teams.

## 5. Run tests and post to Teams

`TEAMS_NOTIFY=1` is set by the npm script below (see [`playwright.config.ts`](playwright.config.ts)).

```bat
npm run test:teams:stg:usa:23005
```

Runs **without** Teams:

```bat
npm run test:loanwalk:stg:usa:23005
```

### What appears on the card

- Title: **Loanwalk API — USA: 23005 (STG)**
- Passed / Failed / Flaky / Skipped
- Per-test **Validation Summary** (from Allure attachments in your specs)

## 6. Scheduled run (Task Scheduler)

### Manual run with log file

From `scripts`:

```bat
cd C:\path\to\Backendapi\scripts
run_scheduled.bat
run_scheduled.bat stg-usa-23005
```

Logs: `logs\teams-stg-usa-23005-<timestamp>.log`

### Register a daily task (recommended)

Run **as the same Windows user** that has Node on PATH and the repo `.env`:

```bat
cd C:\path\to\Backendapi\scripts
setup_schedule.bat
```

Default: **STG USA 23005** every day at **2:00 PM IST** (converted to your PC’s local time).

Change time (IST, 24h `HH:mm`):

```bat
set HC_TIME=09:30
setup_schedule.bat
```

Remove the task:

```bat
setup_schedule.bat remove
```

Test the task immediately:

```bat
schtasks /Run /TN LoanwalkApiTests-STG-USA-23005
```

### Task Scheduler (GUI alternative)

1. **Task Scheduler** → Create Task.
2. **Triggers**: Daily at your preferred time.
3. **Actions**: Start a program  
   - Program: `C:\path\to\Backendapi\scripts\run_scheduled.bat`  
   - Add arguments: `stg-usa-23005`  
   - Start in: `C:\path\to\Backendapi`
4. Run whether user is logged on or not only if Node and `.env` are available to that account.

## 7. Troubleshooting

| Issue | Check |
|--------|--------|
| No card | `TEAMS_WEBHOOK_URL` in `.env`; use `npm run test:teams:stg:usa:23005` (not `test:loanwalk`) |
| Scheduled run, no card | Open latest `logs\teams-*.log`; confirm VPN/network to STG |
| `[teams-detail] Skipping Teams post — unsupported matrix` | Profile must be `stg-usa-23005` (npm script sets `ENV` / `COUNTRY` / `STORE`) |
| Empty validation notes | Specs must attach **Validation Summary** or **Required Attributes Validated ✅** |
| Debug | `TEAMS_DEBUG=1` in `.env` |

## npm scripts

| Script | Teams card |
|--------|------------|
| `test:teams:stg:usa:23005` / `test:teams` | Yes |
| `test:loanwalk:stg:usa:23005` | No |
| `teams:verify-webhook` | Test card only |
