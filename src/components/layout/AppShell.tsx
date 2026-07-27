"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { NotificationBell } from "@/src/components/notifications/NotificationBell";
import {
  featureListToMap,
  getFeatureStatusLabel,
  getTenantFeatureAccess,
  isFeatureEnabled,
  navFeatureByLabel,
  type FeatureAccessMap,
} from "@/src/lib/featureAccess";
import { canAccessNavigationItem } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant } from "@/src/lib/tenant";
import {
  defaultTenantBrandColor,
  getSafeTenantBrandColor,
  getTenantSettings,
  getWorkspaceBranding,
} from "@/src/lib/tenantSettings";

type AppShellProps = {
  activeItem?: string;
  children: ReactNode;
};

type NavItem = {
  displayLabel?: string;
  href: string;
  label: string;
  mobileLabel?: string;
};

const navItems = [
  { href: "/app", label: "Home" },
  { href: "/app/courses", label: "Programs" },
  {
    displayLabel: "Public Page",
    href: "/app/settings/public-site",
    label: "Branding",
  },
  { href: "/app/students", label: "Students" },
  { href: "/app/enrollments", label: "Enrollments", mobileLabel: "Enroll" },
  { href: "/app/sessions", label: "Live Classes" },
  { href: "/app/documents", label: "Content Library" },
  { href: "/app/community", label: "Community" },
  { href: "/app/announcements", label: "Announcements" },
  {
    displayLabel: "Student Finance",
    href: "/app/finance",
    label: "Sales",
  },
  {
    displayLabel: "CoachFort Plan",
    href: "/app/subscription",
    label: "Subscription",
  },
  { href: "/app/reports", label: "Analytics" },
  {
    displayLabel: "Team & Settings",
    href: "/app/settings",
    label: "Settings",
  },
] satisfies NavItem[];

const navGroups = [
  {
    label: "Overview",
    items: ["Home"],
  },
  {
    label: "Grow",
    items: ["Programs", "Branding"],
  },
  {
    label: "Students",
    items: ["Students", "Enrollments"],
  },
  {
    label: "Deliver",
    items: ["Live Classes", "Content Library", "Community", "Announcements"],
  },
  {
    label: "Business",
    items: ["Sales", "Subscription", "Analytics"],
  },
  {
    label: "Workspace",
    items: ["Settings"],
  },
];

const mobilePrimaryLabels = ["Home", "Programs", "Students", "Enrollments"];

function getNavItemLabel(item: NavItem) {
  return item.displayLabel ?? item.label;
}

function getMobileNavItemLabel(item: NavItem) {
  return item.mobileLabel ?? getNavItemLabel(item);
}

function NavIcon({ label }: { label: string }) {
  const iconLabelByAlias: Record<string, string> = {
    Analytics: "Reports",
    Announcements: "Messages",
    Branding: "Public Site",
    Community: "Messages",
    "Content Library": "Documents",
    Home: "Dashboard",
    "Live Classes": "Sessions",
    Programs: "Courses",
    Sales: "Finance",
  };
  const iconLabel = iconLabelByAlias[label] ?? label;
  const commonProps = {
    className: "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
  };

  const paths: Record<string, ReactNode> = {
    Activity: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    Automations: (
      <>
        <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
      </>
    ),
    Assignments: (
      <>
        <path d="M8 6h8" />
        <path d="M8 10h8" />
        <path d="M8 14h5" />
        <rect height="18" rx="2" width="14" x="5" y="3" />
        <path d="M9 19h6" />
      </>
    ),
    Assistant: (
      <>
        <path d="M12 3a7 7 0 0 0-7 7v3a4 4 0 0 0 4 4h1l2 4 2-4h1a4 4 0 0 0 4-4v-3a7 7 0 0 0-7-7Z" />
        <path d="M9 10h.01" />
        <path d="M15 10h.01" />
        <path d="M9.5 14c1.5 1 3.5 1 5 0" />
      </>
    ),
    Approvals: (
      <>
        <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z" />
        <path d="m8.5 12 2.5 2.5L16 9" />
      </>
    ),
    "Backup & Recovery": (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10 12 5l5 5" />
        <path d="M12 5v12" />
        <path d="M5 3h14" />
      </>
    ),
    Cohorts: (
      <>
        <path d="M12 5v14" />
        <path d="M5 9h14" />
        <path d="M5 15h14" />
        <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      </>
    ),
    Compliance: (
      <>
        <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z" />
        <path d="M9 12h6" />
        <path d="M9 16h4" />
        <path d="M9 8h6" />
      </>
    ),
    Courses: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z" />
      </>
    ),
    CRM: (
      <>
        <path d="M4 5h16" />
        <path d="M4 12h16" />
        <path d="M4 19h16" />
        <circle cx="8" cy="5" r="1.5" />
        <circle cx="8" cy="12" r="1.5" />
        <circle cx="8" cy="19" r="1.5" />
      </>
    ),
    Dashboard: (
      <>
        <rect height="8" rx="2" width="8" x="3" y="3" />
        <rect height="5" rx="2" width="8" x="13" y="3" />
        <rect height="8" rx="2" width="8" x="13" y="13" />
        <rect height="5" rx="2" width="8" x="3" y="16" />
      </>
    ),
    Documents: (
      <>
        <path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
        <path d="M14 3v6h5" />
        <path d="M9 13h6" />
        <path d="M9 17h4" />
      </>
    ),
    Enrollments: (
      <>
        <path d="M9 5h6" />
        <path d="M9 12h6" />
        <path d="M9 19h6" />
        <path d="M5 5h.01" />
        <path d="M5 12h.01" />
        <path d="M5 19h.01" />
        <rect height="20" rx="2" width="16" x="4" y="2" />
      </>
    ),
    Finance: (
      <>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
        <path d="M8 6v12" />
        <path d="M16 6v12" />
        <path d="M10 9h4" />
        <path d="M10 15h4" />
      </>
    ),
    Features: (
      <>
        <path d="M4 7h10" />
        <path d="M4 17h10" />
        <circle cx="18" cy="7" r="2" />
        <circle cx="18" cy="17" r="2" />
      </>
    ),
    Messages: (
      <>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
      </>
    ),
    Marketing: (
      <>
        <path d="M4 11v2a3 3 0 0 0 3 3h1l5 3V5L8 8H7a3 3 0 0 0-3 3Z" />
        <path d="M16 9a4 4 0 0 1 0 6" />
        <path d="M19 6a8 8 0 0 1 0 12" />
      </>
    ),
    More: (
      <>
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
      </>
    ),
    "Mobile Readiness": (
      <>
        <rect height="18" rx="3" width="12" x="6" y="3" />
        <path d="M10 7h4" />
        <path d="M11 18h2" />
      </>
    ),
    Notifications: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </>
    ),
    Operations: (
      <>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="M8 16v-5" />
        <path d="M13 16V8" />
        <path d="M18 16v-3" />
        <path d="M7 6h12" />
      </>
    ),
    "Team Operations": (
      <>
        <path d="M16 11a4 4 0 1 0-8 0" />
        <path d="M4 21a8 8 0 0 1 16 0" />
        <path d="M18 4h3" />
        <path d="M19.5 2.5v3" />
      </>
    ),
    Payments: (
      <>
        <rect height="14" rx="2" width="20" x="2" y="5" />
        <path d="M2 10h20" />
      </>
    ),
    "Payment Links": (
      <>
        <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
        <path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" />
      </>
    ),
    Permissions: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
    Portal: (
      <>
        <rect height="12" rx="2" width="18" x="3" y="4" />
        <path d="m10 9 4 3-4 3V9Z" />
        <path d="M8 20h8" />
        <path d="M12 16v4" />
      </>
    ),
    "Public Site": (
      <>
        <path d="M4 5h16" />
        <path d="M5 5v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5" />
        <path d="M8 10h8" />
        <path d="M8 14h5" />
        <path d="M15 18h1" />
      </>
    ),
    Reminders: (
      <>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </>
    ),
    Reports: (
      <>
        <path d="M3 3v18h18" />
        <path d="M8 17V9" />
        <path d="M13 17V5" />
        <path d="M18 17v-4" />
      </>
    ),
    Sessions: (
      <>
        <rect height="16" rx="2" width="18" x="3" y="4" />
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <path d="M3 10h18" />
        <path d="M8 15h.01" />
        <path d="M12 15h.01" />
        <path d="M16 15h.01" />
      </>
    ),
    Settings: (
      <>
        <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    Students: (
      <>
        <path d="M22 10 12 5 2 10l10 5 10-5Z" />
        <path d="M6 12v5c3 2 9 2 12 0v-5" />
      </>
    ),
    Subscription: (
      <>
        <path d="m3 8 4 10h10l4-10-5 3-4-7-4 7-5-3Z" />
        <path d="M7 21h10" />
      </>
    ),
    Workflows: (
      <>
        <path d="M4 6h5" />
        <path d="M4 12h5" />
        <path d="M4 18h5" />
        <path d="M13 6h7" />
        <path d="M13 12h7" />
        <path d="M13 18h7" />
        <path d="m10 6 1 1 2-3" />
        <path d="m10 12 1 1 2-3" />
        <path d="m10 18 1 1 2-3" />
      </>
    ),
  };

  return <svg {...commonProps}>{paths[iconLabel] ?? paths.Dashboard}</svg>;
}

function getGroupedNavItems(items: typeof navItems) {
  const usedLabels = new Set<string>();
  const groups = navGroups
    .map((group) => {
      const groupItems = group.items
        .map((label) => items.find((item) => item.label === label))
        .filter((item): item is (typeof navItems)[number] => Boolean(item));

      groupItems.forEach((item) => usedLabels.add(item.label));

      return {
        ...group,
        items: groupItems,
      };
    })
    .filter((group) => group.items.length > 0);
  const ungroupedItems = items.filter((item) => !usedLabels.has(item.label));

  if (ungroupedItems.length > 0) {
    groups.push({
      label: "More",
      items: ungroupedItems,
    });
  }

  return groups;
}

function getMobilePrimaryNavItems(items: typeof navItems) {
  const primaryItems = mobilePrimaryLabels
    .map((label) => items.find((item) => item.label === label))
    .filter((item): item is (typeof navItems)[number] => Boolean(item));
  const targetCount = Math.min(4, items.length);

  if (primaryItems.length >= targetCount) {
    return primaryItems.slice(0, targetCount);
  }

  const primaryLabels = new Set(primaryItems.map((item) => item.label));
  const fallbackItems = items.filter((item) => !primaryLabels.has(item.label));

  return [...primaryItems, ...fallbackItems].slice(0, targetCount);
}

export function AppShell({ activeItem = "Home", children }: AppShellProps) {
  const [brandColor, setBrandColor] = useState(defaultTenantBrandColor);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);
  const [featureAccess, setFeatureAccess] = useState<FeatureAccessMap | null>(
    null,
  );
  const [routeAccessLoaded, setRouteAccessLoaded] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("CoachFort");

  useEffect(() => {
    let active = true;

    async function loadBrandColor() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!currentTenant) {
          if (active) {
            setRouteAccessLoaded(true);
          }
          return;
        }

        const supabase = getSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const [settings, role, featureResponse] = await Promise.all([
          getTenantSettings(currentTenant.id),
          user
            ? getCurrentMemberRole(currentTenant.id, user.id)
            : Promise.resolve(null),
          getTenantFeatureAccess(currentTenant.id).catch(() => null),
        ]);

        if (active) {
          const branding = getWorkspaceBranding(settings, currentTenant);

          setBrandColor(getSafeTenantBrandColor(settings?.brand_color));
          setCurrentRole(role);
          setFeatureAccess(
            featureResponse ? featureListToMap(featureResponse.features) : null,
          );
          setLogoUrl(branding.logoUrl || branding.iconUrl);
          setWorkspaceName(branding.displayName);
          setRouteAccessLoaded(true);
        }
      } catch {
        if (active) {
          setBrandColor(defaultTenantBrandColor);
          setRouteAccessLoaded(true);
        }
      }
    }

    loadBrandColor();

    return () => {
      active = false;
    };
  }, []);

  const shellStyle = {
    "--coachos-brand": brandColor,
  } as CSSProperties;

  const visibleNavItems = navItems.filter((item) => {
    const featureKey = navFeatureByLabel[item.label];

    return (
      canAccessNavigationItem(currentRole, item.label) &&
      isFeatureEnabled(featureAccess, featureKey)
    );
  });
  const groupedNavItems = getGroupedNavItems(visibleNavItems);
  const mobilePrimaryNavItems = getMobilePrimaryNavItems(visibleNavItems);
  const mobilePrimaryLabelsSet = new Set(
    mobilePrimaryNavItems.map((item) => item.label),
  );
  const mobileOverflowNavItems = visibleNavItems.filter(
    (item) => !mobilePrimaryLabelsSet.has(item.label),
  );
  const mobileOverflowActive = mobileOverflowNavItems.some(
    (item) => item.label === activeItem,
  );
  const activeFeatureKey = navFeatureByLabel[activeItem];
  const activeFeatureStatus = activeFeatureKey
    ? featureAccess?.[activeFeatureKey]?.status
    : undefined;
  const routeRoleAllowed =
    !routeAccessLoaded || canAccessNavigationItem(currentRole, activeItem);
  const routeFeatureEnabled =
    !routeAccessLoaded || isFeatureEnabled(featureAccess, activeFeatureKey);

  const guardedContent = !routeAccessLoaded ? (
    <section className="rounded-2xl border border-[#D8E8F0] bg-white p-6 text-sm font-medium text-[#5D7185] shadow-sm">
      Checking module access...
    </section>
  ) : !routeRoleAllowed ? (
    <section className="rounded-2xl border border-[#FCA5A5] bg-white p-8 shadow-sm shadow-[#0B2A3D]/5">
      <div className="max-w-2xl">
        <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
          Access denied
        </span>
        <h2 className="mt-4 text-2xl font-semibold text-[#0B2A3D]">
          You do not have access to this workspace area.
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#5D7185]">
          This route is restricted by your workspace role. Ask an owner or admin
          if your access needs to change.
        </p>
      </div>
    </section>
  ) : !routeFeatureEnabled ? (
    <section className="rounded-2xl border border-[#D8E8F0] bg-white p-8 shadow-sm shadow-[#0B2A3D]/5">
      <div className="max-w-2xl">
        <span className="inline-flex rounded-full border border-[#D8E8F0] bg-[#F3FAFD] px-3 py-1 text-xs font-semibold text-[#425B76]">
          {getFeatureStatusLabel(activeFeatureStatus)}
        </span>
        <h2 className="mt-4 text-2xl font-semibold text-[#0B2A3D]">
          This module is not enabled for your workspace.
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#5D7185]">
          This area is currently unavailable for your workspace. Your existing
          information is unchanged, and an owner or admin can review workspace
          availability in Settings.
        </p>
        {currentRole === "owner" || currentRole === "admin" ? (
          <Link
            className="mt-6 inline-flex rounded-xl bg-[#145DA0] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0B2A3D]"
            href="/app/settings/features"
          >
            Review workspace settings
          </Link>
        ) : null}
      </div>
    </section>
  ) : (
    children
  );

  return (
    <div
      className="coachos-light h-screen overflow-hidden text-[#0B2A3D]"
      style={shellStyle}
    >
      <div className="pointer-events-none fixed inset-0 bg-[#F8FAFC]" />

      <div className="relative flex h-screen overflow-hidden">
        <aside className="coachos-sidebar hidden h-screen w-72 shrink-0 overflow-y-auto border-r border-[#2ECBEA]/15 bg-[#0B2A3D] px-4 py-5 text-white shadow-lg shadow-[#0B2A3D]/10 lg:block">
          <Link
            className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/5"
            href="/app"
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${workspaceName} logo`}
                className="h-12 w-12 rounded-xl object-cover"
                src={logoUrl}
              />
            ) : (
              <CoachFortBrandAsset className="h-12 w-12" variant="appIcon" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {workspaceName}
              </p>
              <p className="text-xs font-medium text-cyan-50/85">CoachFort workspace</p>
            </div>
          </Link>
          <div className="mt-4 rounded-xl border border-white/15 bg-white/10 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-50/85">
              Navigation
            </p>
            <p className="mt-1 text-xs font-medium text-cyan-50/80">
              Choose the next task for your workspace.
            </p>
          </div>

          <nav aria-label="Workspace navigation" className="mt-6 space-y-6 pb-6">
            {groupedNavItems.map((group) => (
              <div key={group.label}>
                <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-50/80">
                  {group.label}
                </p>
                <div className="mt-2 space-y-1">
                  {group.items.map((item) => {
                    const active = item.label === activeItem;
                    const className = [
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                      active
                        ? "text-[#0B2A3D] shadow-sm shadow-cyan-950/15"
                        : "text-cyan-50/90 hover:bg-white/10 hover:text-white",
                    ].join(" ");
                    const activeStyle = active
                      ? ({ backgroundColor: "#EAF7FC" } satisfies CSSProperties)
                      : undefined;

                    return (
                      <Link
                        aria-current={active ? "page" : undefined}
                        className={className}
                        href={item.href}
                        key={item.label}
                        style={activeStyle}
                      >
                        <span
                          className={[
                            "flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold",
                            active
                              ? "bg-[#0B2A3D] text-[#2ECBEA]"
                              : "bg-white/10 text-cyan-50/90",
                          ].join(" ")}
                        >
                          <NavIcon label={item.label} />
                        </span>
                        <span className="truncate">{getNavItemLabel(item)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <div className="flex h-screen min-w-0 flex-1 flex-col overflow-y-auto pb-24 lg:pb-0">
          <header className="sticky top-0 z-20 border-b border-[#D8E8F0] bg-white/90 text-[#0B2A3D] shadow-sm shadow-[#0B2A3D]/5 backdrop-blur-xl">
            <div className="flex h-18 min-h-18 items-center justify-between px-5 py-3 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={`${workspaceName} logo`}
                    className="h-10 w-10 rounded-xl object-cover lg:hidden"
                    src={logoUrl}
                  />
                ) : (
                  <CoachFortBrandAsset
                    className="h-10 w-10 lg:hidden"
                    variant="appIcon"
                  />
                )}
                <div>
                  <p className="text-xs font-semibold text-[#475569]">
                    Workspace
                  </p>
                  <h1 className="mt-1 max-w-[14rem] truncate text-xl font-semibold text-[#0B2A3D] sm:max-w-[22rem]">
                    {workspaceName}
                  </h1>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <NotificationBell />
                <div
                  className="hidden items-center gap-3 rounded-lg border border-[#9ADDEA] bg-[#EAF8FC] px-3 py-2 text-sm font-semibold text-[#0B2A3D] shadow-sm shadow-[#0B2A3D]/5 sm:flex"
                >
                  <span className="h-2 w-2 rounded-full bg-[#14B8C6]" />
                  Workspace open
                </div>
              </div>
            </div>
          </header>

          <main className="coachos-content flex-1 px-5 py-6 sm:px-6 lg:px-8 lg:py-8">
            {guardedContent}
          </main>
        </div>

        {mobileMoreOpen ? (
          <div className="fixed inset-0 z-30 bg-[#0B1F33]/30 backdrop-blur-[2px] lg:hidden">
            <button
              aria-label="Close navigation menu"
              className="absolute inset-0 h-full w-full cursor-default"
              onClick={() => setMobileMoreOpen(false)}
              type="button"
            />
            <section
              aria-label="More workspace navigation"
              className="absolute inset-x-3 bottom-24 max-h-[68vh] overflow-hidden rounded-xl border border-[#D8E8F0] bg-white text-[#0B2A3D] shadow-2xl shadow-[#0B2A3D]/20"
              id="mobile-more-navigation"
            >
              <div className="flex items-center justify-between border-b border-[#D8E8F0] px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">More modules</p>
                  <p className="text-xs text-[#475569]">
                    Available for your current role and workspace.
                  </p>
                </div>
                <button
                  className="rounded-lg border border-[#D8E8F0] px-3 py-2 text-xs font-semibold text-[#425B76] transition hover:bg-[#F3FAFD] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2ECBEA]"
                  onClick={() => setMobileMoreOpen(false)}
                  type="button"
                >
                  Close
                </button>
              </div>
              <div className="max-h-[52vh] overflow-y-auto p-3">
                <div className="grid gap-2">
                  {mobileOverflowNavItems.map((item) => {
                    const active = item.label === activeItem;

                    return (
                      <Link
                        aria-current={active ? "page" : undefined}
                        className={[
                          "flex items-center gap-3 rounded-lg border px-3 py-3 text-sm font-semibold transition",
                          active
                            ? "border-[#9ADDEA] bg-[#EAF8FC] text-[#0B2A3D]"
                            : "border-transparent text-[#425B76] hover:border-[#D8E8F0] hover:bg-[#F6FBFE] hover:text-[#0B2A3D]",
                        ].join(" ")}
                        href={item.href}
                        key={item.label}
                        onClick={() => setMobileMoreOpen(false)}
                      >
                        <span
                          className={[
                            "flex h-9 w-9 items-center justify-center rounded-lg",
                            active
                              ? "bg-[#0B2A3D] text-[#2ECBEA]"
                              : "bg-[#EAF7FC] text-[#145DA0]",
                          ].join(" ")}
                        >
                          <NavIcon label={item.label} />
                        </span>
                        <span>{getNavItemLabel(item)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        ) : null}

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#D8E8F0] bg-white/95 px-3 py-3 shadow-2xl shadow-[#0B2A3D]/10 backdrop-blur-xl lg:hidden">
          <div
            className={[
              "grid gap-1",
              mobileOverflowNavItems.length > 0 ? "grid-cols-5" : "grid-cols-4",
            ].join(" ")}
          >
            {mobilePrimaryNavItems.map((item) => {
              const active = item.label === activeItem;
              const activeStyle = active
                ? ({ backgroundColor: "#EAF7FC" } satisfies CSSProperties)
                : undefined;

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium",
                    active
                      ? "text-[#06202A] shadow-lg shadow-[#145DA0]/20"
                      : "text-[#5D7185] hover:bg-[#EAF7FC] hover:text-[#0B2A3D]",
                  ].join(" ")}
                  href={item.href}
                  key={item.label}
                  style={activeStyle}
                >
                  <span className="text-[10px] font-bold">
                    <NavIcon label={item.label} />
                  </span>
                  <span className="max-w-full truncate">
                    {getMobileNavItemLabel(item)}
                  </span>
                </Link>
              );
            })}
            {mobileOverflowNavItems.length > 0 ? (
              <button
                aria-controls="mobile-more-navigation"
                aria-expanded={mobileMoreOpen}
                className={[
                  "flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition",
                  mobileMoreOpen || mobileOverflowActive
                    ? "bg-[#EAF7FC] text-[#06202A] shadow-lg shadow-[#145DA0]/20"
                    : "text-[#475569] hover:bg-[#EAF7FC] hover:text-[#0B2A3D]",
                ].join(" ")}
                onClick={() => setMobileMoreOpen((open) => !open)}
                type="button"
              >
                <span className="text-[10px] font-bold">
                  <NavIcon label="More" />
                </span>
                <span>More</span>
              </button>
            ) : null}
          </div>
        </nav>
      </div>
    </div>
  );
}
