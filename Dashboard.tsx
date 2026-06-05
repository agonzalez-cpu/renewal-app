"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  FileDown,
  History,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck
} from "lucide-react";

type ExportJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  objectType: string;
  exportName: string;
  format: string;
  requestedProperties: string[];
  agentInstanceId?: string;
  executionId?: string;
  createdAt: string;
  completedAt?: string;
  fileName?: string;
  fileSize?: number;
  errorMessage?: string;
};

type HubSpotProperty = {
  name: string;
  label: string;
  type: string;
  options?: Array<{ label: string; value: string }>;
};

type BreezeMetadata = {
  agentInstanceId?: string;
  executionId?: string;
};

type WritebackPreview = {
  companyId: string;
  companyName?: string;
  agentInstanceId?: string;
  executionId?: string;
  extractedValues: {
    totalRawScore?: number;
    confidence?: string;
    renewalStatus?: string;
  };
  payload: Record<string, string | number>;
  beforeValues: Record<string, string | null>;
  afterValues: Record<string, string | number>;
};

type BatchParseResult = {
  count?: number;
  valid?: boolean;
  results?: Array<{
    index: number;
    companyId?: string;
    agentInstanceId?: string;
    executionId?: string;
    extractedValues?: Record<string, unknown>;
    errors?: string[];
  }>;
  previews?: WritebackPreview[];
  errors?: Array<{ index: number; message: string }>;
  dryRun?: boolean;
};

const objectOptions = [
  { label: "Contacts", value: "CONTACT" },
  { label: "Companies", value: "COMPANY" },
  { label: "Deals", value: "DEAL" },
  { label: "Tickets", value: "TICKET" },
  { label: "Products", value: "PRODUCT" },
  { label: "Line items", value: "LINE_ITEM" }
];

const commonProperties: Record<string, string[]> = {
  CONTACT: ["email", "firstname", "lastname", "createdate", "hs_lastmodifieddate"],
  COMPANY: ["name", "domain", "industry", "createdate", "hs_lastmodifieddate"],
  DEAL: ["dealname", "amount", "dealstage", "pipeline", "closedate", "hs_lastmodifieddate"],
  TICKET: ["subject", "content", "hs_pipeline", "hs_pipeline_stage", "hs_lastmodifieddate"],
  PRODUCT: ["name", "price", "description", "hs_sku", "hs_lastmodifieddate"],
  LINE_ITEM: ["name", "quantity", "price", "amount", "hs_lastmodifieddate"]
};

const propertyObjectTypes: Record<string, string> = {
  CONTACT: "contacts",
  COMPANY: "companies",
  DEAL: "deals",
  TICKET: "tickets",
  PRODUCT: "products",
  LINE_ITEM: "line_items"
};

const exampleBatch = JSON.stringify(
  [
    {
      breezeUrl:
        "https://app.hubspot.com/breeze-studio/7279725/manage-agents/inbox?agentInstanceId=8537100&executionId=019e6a2b-3547-7df9-b9ec-6588cdf15262",
      companyId: "123456789",
      output: "Total Raw Score: 87\nRenewal Status: Green\nConfidence: High"
    },
    {
      executionId: "019e6a2b-3547-7df9-b9ec-6588cdf15263",
      companyId: "987654321",
      output: {
        "Total Raw Score": 72,
        "Renewal Status": "Yellow",
        Confidence: "Medium"
      }
    }
  ],
  null,
  2
);

function splitProperties(value: string) {
  return value
    .split(/[,\n]/)
    .map((property) => property.trim())
    .filter(Boolean);
}

function formatFileSize(bytes?: number) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data as T;
}

export function Dashboard() {
  const [tab, setTab] = useState<"exports" | "writeback">("writeback");
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [message, setMessage] = useState<string>("");

  const [breezeUrl, setBreezeUrl] = useState("");
  const [metadata, setMetadata] = useState<BreezeMetadata>({});
  const [objectType, setObjectType] = useState("COMPANY");
  const [format, setFormat] = useState<"CSV" | "XLSX" | "XLS">("CSV");
  const [propertyText, setPropertyText] = useState(commonProperties.COMPANY.join("\n"));
  const [properties, setProperties] = useState<HubSpotProperty[]>([]);
  const [includeAssociations, setIncludeAssociations] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [writebackUrl, setWritebackUrl] = useState("");
  const [writebackMetadata, setWritebackMetadata] = useState<BreezeMetadata>({});
  const [companyId, setCompanyId] = useState("");
  const [executionOutput, setExecutionOutput] = useState("");
  const [preview, setPreview] = useState<WritebackPreview | undefined>();
  const [batchInput, setBatchInput] = useState(exampleBatch);
  const [batchResult, setBatchResult] = useState<BatchParseResult>();

  const selectedProperties = useMemo(() => splitProperties(propertyText), [propertyText]);

  async function refreshJobs() {
    const response = await fetch("/api/exports");
    const data = await response.json();
    setJobs(data.jobs ?? []);
  }

  useEffect(() => {
    void refreshJobs();
    const interval = window.setInterval(() => void refreshJobs(), 8000);
    return () => window.clearInterval(interval);
  }, []);

  function updateObjectType(nextObjectType: string) {
    setObjectType(nextObjectType);
    setPropertyText((commonProperties[nextObjectType] ?? []).join("\n"));
    setProperties([]);
  }

  async function parseExportUrl() {
    const data = await postJson<{ metadata: BreezeMetadata }>("/api/executions/parse-url", { url: breezeUrl });
    setMetadata(data.metadata);
    setMessage("Breeze metadata captured for traceability.");
  }

  async function parseWritebackUrl() {
    const data = await postJson<{ metadata: BreezeMetadata }>("/api/executions/parse-url", { url: writebackUrl });
    setWritebackMetadata(data.metadata);
    setMessage("Breeze metadata captured for writeback logging.");
  }

  async function fetchObjectProperties() {
    const response = await fetch(
      `/api/hubspot/properties?objectType=${encodeURIComponent(propertyObjectTypes[objectType] ?? objectType)}`
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to fetch properties.");
    setProperties(data.properties ?? []);
    setMessage("HubSpot properties loaded.");
  }

  function buildFilters() {
    const filters = [];
    if (dateFrom) {
      filters.push({
        propertyName: "hs_lastmodifieddate",
        operator: "GTE",
        value: String(new Date(`${dateFrom}T00:00:00.000Z`).getTime())
      });
    }
    if (dateTo) {
      filters.push({
        propertyName: "hs_lastmodifieddate",
        operator: "LTE",
        value: String(new Date(`${dateTo}T23:59:59.999Z`).getTime())
      });
    }
    return filters.length ? { filterGroups: [{ filters }] } : undefined;
  }

  async function startExport() {
    const data = await postJson<{ job: ExportJob }>("/api/exports/start", {
      breezeUrl,
      objectType,
      format,
      requestedProperties: selectedProperties,
      includeArchived,
      includeAssociations,
      associatedObjectTypes: includeAssociations ? ["CONTACT", "COMPANY", "DEAL", "TICKET"] : [],
      filters: buildFilters()
    });
    setMessage(`Export queued: ${data.job.exportName}`);
    await refreshJobs();
  }

  async function startCommonPreset() {
    for (const option of objectOptions) {
      await postJson("/api/exports/start", {
        breezeUrl,
        objectType: option.value,
        format,
        requestedProperties: commonProperties[option.value] ?? ["hs_object_id"],
        includeArchived,
        includeAssociations: false,
        filters: buildFilters()
      });
    }
    setMessage("Common object exports queued.");
    await refreshJobs();
  }

  async function retryJob(jobId: string) {
    await postJson(`/api/exports/${jobId}/retry`, {});
    setMessage("Retry queued.");
    await refreshJobs();
  }

  async function validateWritebackProperties() {
    const data = await postJson<{ valid: boolean; missing: string[]; errors: string[] }>(
      "/api/hubspot/properties/validate",
      {}
    );
    setMessage(data.valid ? "Writeback properties validated." : "Writeback properties need attention.");
  }

  async function previewWriteback() {
    const data = await postJson<{ preview: WritebackPreview }>("/api/hubspot/companies/preview-update", {
      breezeUrl: writebackUrl,
      companyId: companyId || undefined,
      output: executionOutput
    });
    setPreview(data.preview);
    setMessage("Preview ready. No HubSpot record was updated.");
  }

  async function writeback(dryRun: boolean) {
    const data = await postJson<{ preview: WritebackPreview }>("/api/hubspot/companies/writeback", {
      breezeUrl: writebackUrl,
      companyId: companyId || undefined,
      output: executionOutput,
      dryRun
    });
    setPreview(data.preview);
    setMessage(dryRun ? "Dry run complete. HubSpot was not updated." : "Company updated in HubSpot.");
  }

  async function parseBatch() {
    const data = await postJson<BatchParseResult>("/api/executions/batch-extract", { input: batchInput });
    setBatchResult(data);
    setMessage(data.valid ? `${data.count ?? 0} Breeze outputs parsed.` : "Batch parsed with validation errors.");
  }

  async function batchWriteback(dryRun: boolean) {
    const response = await fetch("/api/hubspot/companies/batch-writeback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: batchInput, dryRun })
    });
    const data = (await response.json()) as BatchParseResult;
    setBatchResult(data);
    if (!response.ok) {
      setMessage("Batch needs fixes before HubSpot can be updated.");
      return;
    }
    setMessage(dryRun ? "Batch dry run complete. HubSpot was not updated." : "Batch writeback submitted.");
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Database size={24} aria-hidden />
          <div>
            <strong>HubSpot Ops</strong>
            <span>Breeze exporter</span>
          </div>
        </div>

        <nav className="nav" aria-label="Primary">
          <button className={tab === "exports" ? "active" : ""} onClick={() => setTab("exports")}>
            <FileDown size={18} aria-hidden />
            Exports
          </button>
          <button className={tab === "writeback" ? "active" : ""} onClick={() => setTab("writeback")}>
            <ClipboardCheck size={18} aria-hidden />
            Breeze batch
          </button>
        </nav>

        <div className="note">
          <ShieldCheck size={18} aria-hidden />
          <p>Breeze agent IDs are stored for traceability; CRM data is exported through HubSpot&apos;s official APIs.</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Production-ready MVP</p>
            <h1>{tab === "exports" ? "CRM export dashboard" : "Mass Breeze writeback"}</h1>
          </div>
          <button className="iconButton" onClick={() => void refreshJobs()} title="Refresh history">
            <RefreshCw size={18} aria-hidden />
          </button>
        </header>

        {message ? <div className="toast">{message}</div> : null}

        {tab === "exports" ? (
          <div className="grid two">
            <section className="panel">
              <div className="sectionTitle">
                <h2>Start export</h2>
                <button onClick={() => void startCommonPreset()}>
                  <Play size={16} aria-hidden />
                  Common preset
                </button>
              </div>

              <label>
                Breeze Studio URL
                <div className="inline">
                  <input value={breezeUrl} onChange={(event) => setBreezeUrl(event.target.value)} />
                  <button type="button" onClick={() => void parseExportUrl()} title="Parse Breeze URL">
                    <ClipboardCheck size={16} aria-hidden />
                  </button>
                </div>
              </label>

              <div className="metadataLine">
                <span>agentInstanceId: {metadata.agentInstanceId ?? "-"}</span>
                <span>executionId: {metadata.executionId ?? "-"}</span>
              </div>

              <div className="split">
                <label>
                  Object
                  <select value={objectType} onChange={(event) => updateObjectType(event.target.value)}>
                    {objectOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Format
                  <select value={format} onChange={(event) => setFormat(event.target.value as "CSV" | "XLSX" | "XLS")}>
                    <option>CSV</option>
                    <option>XLSX</option>
                    <option>XLS</option>
                  </select>
                </label>
              </div>

              <label>
                Properties
                <textarea value={propertyText} onChange={(event) => setPropertyText(event.target.value)} rows={7} />
              </label>

              <div className="propertyToolbar">
                <button type="button" onClick={() => void fetchObjectProperties()}>
                  <RefreshCw size={16} aria-hidden />
                  Load properties
                </button>
                <span>{selectedProperties.length} selected</span>
              </div>

              {properties.length ? (
                <div className="propertyList">
                  {properties.slice(0, 48).map((property) => (
                    <button
                      type="button"
                      key={property.name}
                      onClick={() =>
                        setPropertyText((current) => {
                          const values = new Set(splitProperties(current));
                          if (values.has(property.name)) {
                            values.delete(property.name);
                          } else {
                            values.add(property.name);
                          }
                          return Array.from(values).join("\n");
                        })
                      }
                    >
                      {property.label || property.name}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="split">
                <label>
                  Modified from
                  <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                </label>
                <label>
                  Modified to
                  <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                </label>
              </div>

              <div className="toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={includeAssociations}
                    onChange={(event) => setIncludeAssociations(event.target.checked)}
                  />
                  Include associations where supported
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={includeArchived}
                    onChange={(event) => setIncludeArchived(event.target.checked)}
                  />
                  Include archived metadata
                </label>
              </div>

              <button className="primary" type="button" onClick={() => void startExport()}>
                <Play size={18} aria-hidden />
                Queue export
              </button>
            </section>

            <HistoryPanel jobs={jobs} retryJob={retryJob} />
          </div>
        ) : (
          <div className="grid two">
            <section className="panel spanTwo">
              <div className="sectionTitle">
                <h2>Mass Breeze outputs</h2>
                <div className="buttonRow compact">
                  <button type="button" onClick={() => void validateWritebackProperties()}>
                    <CheckCircle2 size={16} aria-hidden />
                    Validate
                  </button>
                  <button type="button" onClick={() => void parseBatch()}>
                    <ClipboardCheck size={16} aria-hidden />
                    Parse
                  </button>
                  <button type="button" onClick={() => void batchWriteback(true)}>
                    <ShieldCheck size={16} aria-hidden />
                    Dry run
                  </button>
                  <button type="button" onClick={() => void batchWriteback(false)}>
                    <Play size={16} aria-hidden />
                    Batch write
                  </button>
                </div>
              </div>
              <label>
                Batch input
                <textarea value={batchInput} onChange={(event) => setBatchInput(event.target.value)} rows={12} />
              </label>
              {batchResult ? <pre className="result">{JSON.stringify(batchResult, null, 2)}</pre> : null}
            </section>

            <section className="panel spanTwo">
              <div className="sectionTitle">
                <h2>Live Breeze receiver</h2>
                <ShieldCheck size={18} aria-hidden />
              </div>
              <div className="webhookGrid">
                <div className="metric">
                  <span>Local receiver</span>
                  <strong>/api/webhooks/breeze-output</strong>
                  <small>Use a public HTTPS tunnel or deployment for HubSpot agent tools.</small>
                </div>
                <div className="metric">
                  <span>Modes</span>
                  <strong>parse_only · dry_run · write</strong>
                  <small>Start with dry_run, then switch to write after the preview looks right.</small>
                </div>
              </div>
              <pre>{`{
  "inputFields": {
    "companyId": "123456789",
    "executionId": "exec-1",
    "mode": "dry_run",
    "breezeOutput": "Total Raw Score: 87\\nRenewal Status: Green\\nConfidence: High"
  }
}`}</pre>
            </section>

            <section className="panel">
              <div className="sectionTitle">
                <h2>Single preview</h2>
                <button type="button" onClick={() => void validateWritebackProperties()}>
                  <CheckCircle2 size={16} aria-hidden />
                  Validate
                </button>
              </div>

              <label>
                Breeze Studio URL
                <div className="inline">
                  <input value={writebackUrl} onChange={(event) => setWritebackUrl(event.target.value)} />
                  <button type="button" onClick={() => void parseWritebackUrl()} title="Parse Breeze URL">
                    <ClipboardCheck size={16} aria-hidden />
                  </button>
                </div>
              </label>

              <div className="metadataLine">
                <span>agentInstanceId: {writebackMetadata.agentInstanceId ?? "-"}</span>
                <span>executionId: {writebackMetadata.executionId ?? "-"}</span>
              </div>

              <label>
                Company ID
                <input value={companyId} onChange={(event) => setCompanyId(event.target.value)} />
              </label>

              <label>
                Breeze execution output
                <textarea
                  value={executionOutput}
                  onChange={(event) => setExecutionOutput(event.target.value)}
                  rows={10}
                  placeholder={'{"Total Raw Score": 87, "Renewal Status": "Green", "Confidence": "High"}'}
                />
              </label>

              <div className="buttonRow">
                <button type="button" onClick={() => void previewWriteback()}>
                  <ClipboardCheck size={16} aria-hidden />
                  Preview
                </button>
                <button type="button" onClick={() => void writeback(true)}>
                  <ShieldCheck size={16} aria-hidden />
                  Dry run
                </button>
                <button className="primary" type="button" onClick={() => void writeback(false)}>
                  <Play size={16} aria-hidden />
                  Write to HubSpot
                </button>
              </div>
            </section>

            <section className="panel">
              <h2>Dry-run preview</h2>
              {preview ? (
                <div className="preview">
                  <div className="metric">
                    <span>Company</span>
                    <strong>{preview.companyName ?? "Unknown"}</strong>
                    <small>{preview.companyId}</small>
                  </div>
                  <pre>{JSON.stringify(preview.payload, null, 2)}</pre>
                  <div className="comparison">
                    <div>
                      <h3>Before</h3>
                      <pre>{JSON.stringify(preview.beforeValues, null, 2)}</pre>
                    </div>
                    <div>
                      <h3>After</h3>
                      <pre>{JSON.stringify(preview.afterValues, null, 2)}</pre>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty">Run preview to see the exact HubSpot company update payload.</div>
              )}
            </section>

          </div>
        )}
      </section>
    </main>
  );
}

function HistoryPanel({ jobs, retryJob }: { jobs: ExportJob[]; retryJob: (jobId: string) => Promise<void> }) {
  return (
    <section className="panel">
      <div className="sectionTitle">
        <h2>Export history</h2>
        <History size={18} aria-hidden />
      </div>

      <div className="historyList">
        {jobs.length ? (
          jobs.map((job) => (
            <article className="historyItem" key={job.id}>
              <div>
                <strong>{job.exportName}</strong>
                <span>
                  {job.objectType} · {job.status} · {new Date(job.createdAt).toLocaleString()}
                </span>
                <small>{job.requestedProperties.join(", ")}</small>
                {job.executionId ? <small>executionId: {job.executionId}</small> : null}
                {job.errorMessage ? <small className="errorText">{job.errorMessage}</small> : null}
              </div>
              <div className="historyActions">
                <span>{formatFileSize(job.fileSize)}</span>
                {job.status === "completed" ? (
                  <a className="iconButton" href={`/api/exports/${job.id}/download`} title="Download export">
                    <Download size={18} aria-hidden />
                  </a>
                ) : null}
                {job.status === "failed" ? (
                  <button className="iconButton" onClick={() => void retryJob(job.id)} title="Retry export">
                    <RotateCcw size={18} aria-hidden />
                  </button>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="empty">No export jobs yet.</div>
        )}
      </div>
    </section>
  );
}
