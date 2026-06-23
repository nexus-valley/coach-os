"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/src/components/ui/Badge";
import { Card } from "@/src/components/ui/Card";
import {
  getMobileBootstrap,
  getMobileNotifications,
  getMobileOfflineManifest,
  getMobileTeamHome,
  getMobileTrainerHome,
} from "@/src/lib/mobileApi";
import type {
  MobileBootstrap,
  MobileNotificationsResponse,
  MobileOfflineManifest,
  MobileTeamHome,
  MobileTrainerHome,
} from "@/src/lib/mobileTypes";

type PreviewState = {
  bootstrap: MobileBootstrap | null;
  error: string | null;
  home: MobileTeamHome | MobileTrainerHome | null;
  loading: boolean;
  manifest: MobileOfflineManifest | null;
  notifications: MobileNotificationsResponse | null;
};

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return "Unable to load mobile readiness payload.";
}

function PayloadCard({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  return (
    <Card className="overflow-hidden rounded-2xl p-0">
      <div className="border-b border-[#D8E8F0] px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#5B7083]">
          {title}
        </h2>
      </div>
      <pre className="max-h-[28rem] overflow-auto bg-[#F8FCFE] p-5 text-xs leading-5 text-[#0B2A3D]">
        {formatJson(value)}
      </pre>
    </Card>
  );
}

export function MobileReadinessPage() {
  const [state, setState] = useState<PreviewState>({
    bootstrap: null,
    error: null,
    home: null,
    loading: true,
    manifest: null,
    notifications: null,
  });

  const loadPreview = useCallback(async () => {
    setState((current) => ({ ...current, error: null, loading: true }));

    try {
      const bootstrap = await getMobileBootstrap();
      const [notifications, manifest] = await Promise.all([
        getMobileNotifications(10, 0),
        getMobileOfflineManifest(),
      ]);

      let home: MobileTeamHome | MobileTrainerHome | null = null;

      if (bootstrap.mode === "team") {
        home =
          bootstrap.role === "trainer"
            ? await getMobileTrainerHome()
            : await getMobileTeamHome();
      }

      setState({
        bootstrap,
        error: null,
        home,
        loading: false,
        manifest,
        notifications,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        error: errorMessage(error),
        loading: false,
      }));
    }
  }, []);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const contextLabel = useMemo(() => {
    if (!state.bootstrap) {
      return "Loading";
    }

    if (state.bootstrap.mode === "team") {
      return `${state.bootstrap.role} team context`;
    }

    return state.bootstrap.mode === "student"
      ? "student context"
      : "no mobile context";
  }, [state.bootstrap]);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-3xl border border-[#D8E8F0] bg-white p-6 shadow-xl shadow-[#0B2A3D]/10 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-[#0B1F33]">
              Mobile API Readiness
            </h1>
            <Badge tone={state.error ? "danger" : "success"}>
              {contextLabel}
            </Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-[#5B7083]">
            Read-only developer preview for the future CoachFort mobile app
            startup contract. Native clients should consume these RPC payloads
            instead of querying many raw tables directly.
          </p>
        </div>
        <button
          className="rounded-full bg-[#145DA0] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-[#145DA0]/20 transition hover:bg-[#0B2A3D] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={state.loading}
          onClick={loadPreview}
          type="button"
        >
          {state.loading ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {state.error ? (
        <Card className="rounded-2xl border-[#FECACA] bg-[#FEF2F2] p-5 text-sm text-[#B91C1C]">
          {state.error}
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5B7083]">
            Context
          </p>
          <p className="mt-3 text-2xl font-bold text-[#0B1F33]">
            {state.bootstrap?.mode ?? "loading"}
          </p>
        </Card>
        <Card className="rounded-2xl p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5B7083]">
            Sections
          </p>
          <p className="mt-3 text-2xl font-bold text-[#0B1F33]">
            {state.bootstrap?.sections.length ?? 0}
          </p>
        </Card>
        <Card className="rounded-2xl p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5B7083]">
            Unread
          </p>
          <p className="mt-3 text-2xl font-bold text-[#0B1F33]">
            {state.notifications?.unread_count ?? 0}
          </p>
        </Card>
        <Card className="rounded-2xl p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5B7083]">
            Offline Manifest
          </p>
          <p className="mt-3 text-2xl font-bold text-[#0B1F33]">
            {state.manifest ? "ready" : "pending"}
          </p>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <PayloadCard title="Bootstrap Payload" value={state.bootstrap} />
        <PayloadCard title="Home Payload" value={state.home} />
        <PayloadCard title="Notifications Payload" value={state.notifications} />
        <PayloadCard title="Offline Manifest" value={state.manifest} />
      </section>
    </div>
  );
}
