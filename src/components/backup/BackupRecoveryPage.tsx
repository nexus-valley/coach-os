"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AccessDeniedCard } from "@/src/components/security/AccessDeniedCard";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import {
  downloadCsv,
  exportTenantDataset,
  getBackupRecoveryData,
  logBackupCenterViewed,
  type BackupDatasetConfig,
  type BackupExportLog,
  type BackupRecoveryData,
} from "@/src/lib/backup";
import { getCurrentTenant, type Tenant } from "@/src/lib/tenant";

function getErrorMessage(caught: unknown) {
  if (caught instanceof Error) {
    return caught.message;
  }

  if (
    caught &&
    typeof caught === "object" &&
    "message" in caught &&
    typeof caught.message === "string"
  ) {
    return caught.message;
  }

  return "Unable to load backup center.";
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function StatusCard({
  helper,
  label,
  tone,
  value,
}: {
  helper: string;
  label: string;
  tone: "danger" | "light" | "success" | "warning";
  value: string;
}) {
  return (
    <Card className="p-5 shadow-sm">
      <Badge tone={tone}>{label}</Badge>
      <p className="mt-4 text-2xl font-semibold tracking-normal text-[#0B1F33]">
        {value}
      </p>
      <p className="mt-2 text-sm leading-6 text-[#66788F]">{helper}</p>
    </Card>
  );
}

function DataExportPanel({
  datasets,
  disabled,
  exporting,
  onExport,
}: {
  datasets: BackupDatasetConfig[];
  disabled: boolean;
  exporting: string | null;
  onExport: (exportType: string) => void;
}) {
  return (
    <Card className="p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <Badge tone="owner">Tenant-scoped exports</Badge>
          <h2 className="mt-4 text-xl font-semibold text-[#0B1F33]">
            Data Export Tools
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66788F]">
            Exports use the signed-in owner/admin session and existing RLS. They
            do not use service-role credentials in the browser.
          </p>
        </div>
        <Badge tone="warning">5,000 row limit per export</Badge>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {datasets.map((dataset) => (
          <div
            className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
            key={dataset.exportType}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-[#0B1F33]">{dataset.label}</p>
                <p className="mt-2 text-sm leading-6 text-[#66788F]">
                  {dataset.description}
                </p>
              </div>
              <Badge tone="light">CSV</Badge>
            </div>
            <Button
              className="mt-4 w-full"
              disabled={disabled || exporting === dataset.exportType}
              onClick={() => onExport(dataset.exportType)}
              type="button"
              variant="secondary"
            >
              {exporting === dataset.exportType ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecoveryChecklist({ data }: { data: BackupRecoveryData }) {
  return (
    <Card className="p-6 shadow-sm">
      <Badge tone="light">Recovery readiness</Badge>
      <h2 className="mt-4 text-xl font-semibold text-[#0B1F33]">
        Recovery Checklist
      </h2>
      <p className="mt-2 text-sm leading-6 text-[#66788F]">
        These checks separate what CoachFort can export from infrastructure work
        that must be handled through Supabase, Vercel, GitHub, DNS, and secure
        operations documentation.
      </p>
      <div className="mt-6 space-y-3">
        {data.readiness.map((item) => (
          <div
            className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
            key={item.key}
          >
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
              <div>
                <p className="font-semibold text-[#0B1F33]">{item.title}</p>
                <p className="mt-2 text-sm leading-6 text-[#66788F]">
                  {item.description}
                </p>
              </div>
              <Badge
                tone={
                  item.status === "ready"
                    ? "success"
                    : item.status === "action_needed"
                      ? "danger"
                      : "warning"
                }
              >
                {item.status.replace(/_/g, " ")}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ExportActivityTimeline({ logs }: { logs: BackupExportLog[] }) {
  if (logs.length === 0) {
    return (
      <Card className="p-6 shadow-sm">
        <Badge tone="light">Export activity</Badge>
        <h2 className="mt-4 text-xl font-semibold text-[#0B1F33]">
          No exports recorded yet
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#66788F]">
          Completed and failed export attempts will appear here after owner/admin
          users export tenant data.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 shadow-sm">
      <Badge tone="light">Export activity</Badge>
      <h2 className="mt-4 text-xl font-semibold text-[#0B1F33]">
        Recent Backup Export Activity
      </h2>
      <div className="mt-5 space-y-3">
        {logs.map((log) => (
          <div
            className="rounded-2xl border border-[#D8E8F0] bg-[#F6FBFE] p-4"
            key={log.id}
          >
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
              <div>
                <p className="font-semibold text-[#0B1F33]">
                  {log.export_type.replace(/_/g, " ")}
                </p>
                <p className="mt-1 text-sm text-[#66788F]">
                  {formatDateTime(log.created_at)}
                  {typeof log.row_count === "number"
                    ? ` - ${log.row_count.toLocaleString()} rows`
                    : ""}
                </p>
              </div>
              <Badge
                tone={
                  log.status === "completed"
                    ? "success"
                    : log.status === "failed"
                      ? "danger"
                      : "warning"
                }
              >
                {log.status}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function BackupRecoveryPage() {
  const [data, setData] = useState<BackupRecoveryData | null>(null);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exportSuccess, setExportSuccess] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const denied = useMemo(
    () => error.toLowerCase().includes("owners and admins"),
    [error],
  );

  const loadBackupData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const currentTenant = await getCurrentTenant();

      if (!currentTenant) {
        setTenant(null);
        setData(null);
        setError("Select or create a workspace before opening backups.");
        return;
      }

      const backupData = await getBackupRecoveryData(currentTenant.id);
      setTenant(currentTenant);
      setData(backupData);
      void logBackupCenterViewed(currentTenant.id);
    } catch (caught) {
      setData(null);
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadBackupData();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadBackupData]);

  async function handleExport(exportType: string) {
    if (!tenant) {
      return;
    }

    setExporting(exportType);
    setExportError("");
    setExportSuccess("");

    try {
      const result = await exportTenantDataset(tenant.id, exportType);
      downloadCsv(result.filename, result.rows);
      setExportSuccess(
        `Exported ${result.rows.length.toLocaleString()} ${exportType.replace(
          /_/g,
          " ",
        )} row${result.rows.length === 1 ? "" : "s"}.`,
      );
      await loadBackupData();
    } catch (caught) {
      setExportError(getErrorMessage(caught));
    } finally {
      setExporting(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="h-72 animate-pulse">
          <span className="sr-only">Loading Backup & Recovery Center</span>
        </Card>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="mx-auto max-w-7xl">
        <AccessDeniedCard description="Backup and recovery access is available to workspace owners and admins only." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="border-red-200 bg-red-50 p-5 text-red-800">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Unable to load Backup & Recovery Center.</p>
              <p className="mt-2 text-sm leading-6">{error}</p>
            </div>
            <Button onClick={loadBackupData} type="button" variant="secondary">
              Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <Badge tone="owner">Owner/admin only</Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
            Backup & Recovery Center
          </h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[#425B76]">
            Tenant-level export readiness, recovery checklist, and audit trail
            for {tenant?.name ?? "this workspace"}. Infrastructure restores must
            remain outside the browser.
          </p>
        </div>
        <div className="rounded-full border border-[#D8E8F0] bg-white px-4 py-2 text-sm font-semibold text-[#425B76] shadow-sm">
          Generated {formatDateTime(data.generatedAt)}
        </div>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard
          helper="Tenant CSV exports are available for owner/admin recovery workflows."
          label="Export readiness"
          tone="success"
          value="Available"
        />
        <StatusCard
          helper="Point-in-time restore must be handled through Supabase or a controlled backend process."
          label="Infrastructure backup"
          tone="warning"
          value="Manual verification"
        />
        <StatusCard
          helper="Most recent completed export tracked by CoachFort."
          label="Last export"
          tone={data.lastExportAt ? "success" : "warning"}
          value={formatDateTime(data.lastExportAt)}
        />
        <StatusCard
          helper="Client-side restore buttons are intentionally not available."
          label="Restore safety"
          tone="success"
          value="No destructive controls"
        />
      </section>

      {exportError ? (
        <Card className="mt-6 border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {exportError}
        </Card>
      ) : null}
      {exportSuccess ? (
        <Card className="mt-6 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {exportSuccess}
        </Card>
      ) : null}

      <section className="mt-8">
        <DataExportPanel
          datasets={data.datasets}
          disabled={Boolean(exporting)}
          exporting={exporting}
          onExport={handleExport}
        />
      </section>

      <section className="mt-10 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <RecoveryChecklist data={data} />
        <div className="space-y-5">
          <Card className="p-6 shadow-sm">
            <Badge tone="warning">Risk warnings</Badge>
            <h2 className="mt-4 text-xl font-semibold text-[#0B1F33]">
              Recovery Boundaries
            </h2>
            <div className="mt-5 space-y-3">
              {data.risks.map((risk) => (
                <div
                  className="rounded-2xl border border-[#FED7AA] bg-[#FFFBF7] p-4"
                  key={risk.key}
                >
                  <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                    <div>
                      <p className="font-semibold text-[#0B1F33]">{risk.title}</p>
                      <p className="mt-2 text-sm leading-6 text-[#9A3412]">
                        {risk.description}
                      </p>
                    </div>
                    <Badge tone={risk.severity === "warning" ? "danger" : "warning"}>
                      {risk.severity}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-6 shadow-sm">
            <Badge tone="light">Recommended recovery steps</Badge>
            <ol className="mt-5 space-y-3 text-sm leading-6 text-[#425B76]">
              <li>1. Confirm Supabase backup/PITR availability for the project.</li>
              <li>2. Verify GitHub repository and Vercel project access.</li>
              <li>3. Confirm environment variables are stored securely.</li>
              <li>4. Export tenant CSV snapshots before major operational changes.</li>
              <li>5. Document DNS and domain recovery contacts.</li>
            </ol>
          </Card>
        </div>
      </section>

      <section className="mt-10">
        <ExportActivityTimeline logs={data.logs} />
      </section>
    </div>
  );
}
