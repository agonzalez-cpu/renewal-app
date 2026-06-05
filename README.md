# HubSpot Breeze Batch Writeback MVP

A Next.js app for mass-processing HubSpot Breeze execution outputs and writing the extracted renewal values back to HubSpot company records. It also includes a CRM export dashboard, but the primary workflow is bulk Breeze output writeback.

## What It Does

- Parses pasted Breeze output batches as JSON, JSONL, or CSV.
- Receives future Breeze outputs from a HubSpot agent tool at `POST /api/webhooks/breeze-output`.
- Starts HubSpot CRM Exports API jobs, polls them, downloads completed files, and stores an audit trail.
- Stores optional Breeze Studio `agentInstanceId` and `executionId` only as traceability metadata.
- Extracts `Total Raw Score`, `Renewal Status`, and `Confidence` from structured JSON or messy text.
- Previews and optionally writes the values to HubSpot companies using the confirmed internal names:
  - `renewal_health_score`
  - `renewal_confidence`
- `renewal_status`
- Validates those company properties exist before writeback and validates dropdown options when HubSpot exposes them as enumerations.

## HubSpot API Notes

I inspected HubSpot's current docs before implementation:

- Current CRM Exports API docs show `POST /crm/exports/2026-03/export/async` and the legacy-compatible `POST /crm/v3/exports/export/async`.
- Export status is read from `/crm/.../export/async/tasks/{taskId}/status`; the result download URL appears in `result` only after status is `COMPLETE`.
- Company updates use `PATCH /crm/v3/objects/companies/{companyId}` and batch updates use `POST /crm/v3/objects/companies/batch/update`.
- Company properties are read with `GET /crm/v3/properties/companies`; the API requires internal property names in write payloads.
- I did not find a documented public Breeze execution-output API in the inspected HubSpot CRM docs. This MVP accepts pasted execution output batches and treats Breeze IDs as metadata, not CRM data identifiers.
- HubSpot agent tools can send future outputs to a public `actionUrl` with signed `POST` requests. This is the supported path for capturing new Breeze outputs as they are created.

The client has a version boundary so exports can be switched with `HUBSPOT_EXPORT_API_VERSION=2026-03`, but the default remains `v3` for broad compatibility.

## Setup

```bash
cd /Users/amandagonzalez/Documents/Codex/hubspot-breeze-exporter
npm install
cp .env.example .env.local
```

Edit `.env.local` and set `HUBSPOT_ACCESS_TOKEN`.

For the live Breeze receiver, also set:

```bash
HUBSPOT_CLIENT_SECRET=your_hubspot_app_client_secret
BREEZE_WEBHOOK_ALLOW_UNSIGNED=false
BREEZE_WEBHOOK_DEFAULT_MODE=dry_run
PUBLIC_APP_URL=https://your-public-app.example.com
```

Recommended private app scopes depend on the objects you export, but for the writeback workflow include:

- `crm.objects.companies.read`
- `crm.objects.companies.write`

Add read scopes for objects you export, such as contacts, deals, tickets, products, and line items.

## Run Locally

```bash
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Test and Verify

```bash
npm run test
npm run typecheck
npm run lint
```

## Production Notes

- Do not expose HubSpot tokens to browsers. This app only calls HubSpot from server routes.
- The local queue is intentionally in-process for development. Production should run the same job interface from a durable worker queue such as BullMQ, Cloud Tasks, or a managed queue.
- Local file storage implements the storage interface. The `s3` driver boundary is present so an S3-compatible adapter can be added without changing API routes.
- SQLite is the local database. The persistence layer is isolated so Postgres can replace it for production.

## Mass Breeze Writeback

Use the **Breeze batch** screen first.

Recommended order:

1. Paste a batch of Breeze execution outputs.
2. Click **Validate** to confirm the three HubSpot company properties exist.
3. Click **Parse** to extract values without touching HubSpot.
4. Click **Dry run** to fetch company records and preview before/after values.
5. Click **Batch write** after the dry-run result looks right.

The batch endpoint accepts:

- JSON array
- JSON Lines
- CSV with a header row

Required per row:

- `companyId`
- Either `output`, or separate columns for `totalRawScore`, `renewalStatus`, and `confidence`

Optional per row:

- `breezeUrl`
- `agentInstanceId`
- `executionId`

## Live Breeze Agent Tool

Use this for future outputs, not historical inbox export.

HubSpot agent tools require a publicly accessible `actionUrl`. Localhost will not work directly from HubSpot. For testing, expose the app with a secure tunnel or deploy it, then configure the action URL:

```text
https://YOUR_PUBLIC_APP_URL/api/webhooks/breeze-output
```

The receiver accepts HubSpot agent-tool request bodies shaped like:

```json
{
  "inputFields": {
    "companyId": "123456789",
    "executionId": "019e6a2b-3547-7df9-b9ec-6588cdf15262",
    "agentInstanceId": "8537100",
    "mode": "dry_run",
    "breezeOutput": "Total Raw Score: 87\nRenewal Status: Healthy\nConfidence: High"
  }
}
```

Modes:

- `parse_only`: extracts values and logs the event, without calling HubSpot company APIs.
- `dry_run`: fetches company values and returns the would-be update payload.
- `write`: updates the company record.

The sample agent-tool config is in:

```text
hubspot-agent-tool/breeze-renewal-writeback-hsmeta.json
```

Before upload, replace:

```text
https://YOUR_PUBLIC_APP_URL/api/webhooks/breeze-output
```

with your deployed or tunneled public HTTPS URL. HubSpot signs agent-tool requests; the app validates HubSpot signatures with `HUBSPOT_CLIENT_SECRET` unless `BREEZE_WEBHOOK_ALLOW_UNSIGNED=true` is set for local-only testing.

## Breeze Batch JSON Shape

```json
[
  {
    "breezeUrl": "https://app.hubspot.com/breeze-studio/7279725/manage-agents/inbox?agentInstanceId=8537100&executionId=019e6a2b-3547-7df9-b9ec-6588cdf15262",
    "companyId": "123456789",
    "output": "Total Raw Score: 87\nRenewal Status: Healthy\nConfidence: High"
  }
]
```

## Breeze Batch CSV Shape

```csv
companyId,executionId,output
123456789,019e6a2b-3547-7df9-b9ec-6588cdf15262,"Total Raw Score: 87
Renewal Status: Healthy
Confidence: High"
```

Or use separate value columns:

```csv
companyId,executionId,totalRawScore,renewalStatus,confidence
123456789,019e6a2b-3547-7df9-b9ec-6588cdf15262,87,Healthy,High
```

Set `dryRun` in the UI or API body to preview without updating HubSpot. The app does not write partial company updates unless `allowPartial` is explicitly enabled.
