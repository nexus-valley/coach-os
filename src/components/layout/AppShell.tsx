"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { canAccessNavigationItem } from "@/src/lib/permissions";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import { getCurrentMemberRole, type MemberRole } from "@/src/lib/team";
import { getCurrentTenant } from "@/src/lib/tenant";
import {
  defaultTenantBrandColor,
  getSafeTenantBrandColor,
  getTenantSettings,
} from "@/src/lib/tenantSettings";

type AppShellProps = {
  activeItem?: string;
  children: ReactNode;
};

const navItems = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/courses", label: "Courses" },
  { href: "/app/cohorts", label: "Cohorts" },
  { href: "/app/students", label: "Students" },
  { href: "/app/student-portal", label: "Portal" },
  { href: "/app/enrollments", label: "Enrollments" },
  { href: "/app/payments", label: "Payments" },
  { href: "/app/payment-links", label: "Payment Links" },
  { href: "/app/reminders", label: "Reminders" },
  { href: "/app/automations", label: "Automations" },
  { href: "/app/reports", label: "Reports" },
  { href: "/app/activity", label: "Activity" },
  { href: "/app/subscription", label: "Subscription" },
  { href: "/app/settings", label: "Settings" },
];

function NavIcon({ label }: { label: string }) {
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
    Cohorts: (
      <>
        <path d="M12 5v14" />
        <path d="M5 9h14" />
        <path d="M5 15h14" />
        <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      </>
    ),
    Courses: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z" />
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
    Portal: (
      <>
        <rect height="12" rx="2" width="18" x="3" y="4" />
        <path d="m10 9 4 3-4 3V9Z" />
        <path d="M8 20h8" />
        <path d="M12 16v4" />
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
  };

  return <svg {...commonProps}>{paths[label] ?? paths.Dashboard}</svg>;
}

export function AppShell({ activeItem = "Dashboard", children }: AppShellProps) {
  const [brandColor, setBrandColor] = useState(defaultTenantBrandColor);
  const [currentRole, setCurrentRole] = useState<MemberRole | null>(null);

  useEffect(() => {
    let active = true;

    async function loadBrandColor() {
      try {
        const currentTenant = await getCurrentTenant();

        if (!currentTenant) {
          return;
        }

        const supabase = getSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const [settings, role] = await Promise.all([
          getTenantSettings(currentTenant.id),
          user
            ? getCurrentMemberRole(currentTenant.id, user.id)
            : Promise.resolve(null),
        ]);

        if (active) {
          setBrandColor(getSafeTenantBrandColor(settings?.brand_color));
          setCurrentRole(role);
        }
      } catch {
        if (active) {
          setBrandColor(defaultTenantBrandColor);
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

  const visibleNavItems = navItems.filter(
    (item) => canAccessNavigationItem(currentRole, item.label),
  );

  return (
    <div
      className="coachos-light h-screen overflow-hidden text-[#0B2A3D]"
      style={shellStyle}
    >
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(46,203,234,0.2),transparent_32rem),linear-gradient(135deg,rgba(243,250,253,0.95),rgba(255,255,255,0.72))]" />

      <div className="relative flex h-screen overflow-hidden">
        <aside className="coachos-sidebar hidden h-screen w-72 shrink-0 overflow-y-auto border-r border-[#2ECBEA]/20 bg-[linear-gradient(180deg,#0B2A3D_0%,#145DA0_100%)] px-4 py-5 text-white shadow-2xl shadow-[#0B2A3D]/20 lg:block">
          <Link className="flex items-center gap-3 px-2" href="/app">
            <CoachFortBrandAsset className="h-14 w-14" variant="appIcon" />
            <div>
              <p className="text-base font-semibold">CoachFort</p>
              <p className="text-xs text-cyan-100/80">by Nexus Valley</p>
            </div>
          </Link>

          <nav className="mt-10 space-y-1">
            {visibleNavItems.map((item) => {
              const active = item.label === activeItem;
              const className = [
                "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition",
                active
                  ? "text-[#0B2A3D] shadow-lg shadow-cyan-950/20"
                  : "text-cyan-50/75 hover:bg-white/10 hover:text-white",
              ].join(" ");
              const activeStyle = active
                ? ({ backgroundColor: "#EAF7FC" } satisfies CSSProperties)
                : undefined;
              const content = (
                <>
                  <span
                    className={[
                      "flex h-8 w-8 items-center justify-center rounded-xl text-[10px] font-bold",
                      active
                        ? "bg-[#0B2A3D] text-[#2ECBEA]"
                        : "bg-white/10 text-cyan-50/80",
                    ].join(" ")}
                  >
                    <NavIcon label={item.label} />
                  </span>
                  {item.label}
                </>
              );

              return (
                <Link
                  className={className}
                  href={item.href}
                  key={item.label}
                  style={activeStyle}
                >
                  {content}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="flex h-screen min-w-0 flex-1 flex-col overflow-y-auto pb-24 lg:pb-0">
          <header className="sticky top-0 z-20 border-b border-[#D8E8F0] bg-white/80 text-[#0B2A3D] shadow-sm shadow-[#0B2A3D]/5 backdrop-blur-xl">
            <div className="flex h-20 items-center justify-between px-5 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3">
                <CoachFortBrandAsset
                  className="h-10 w-10 lg:hidden"
                  variant="appIcon"
                />
                <div>
                  <p className="text-xs font-semibold text-[#5D7185]">
                    by Nexus Valley
                  </p>
                  <h1 className="mt-1 text-xl font-semibold text-[#0B2A3D]">
                    CoachFort
                  </h1>
                </div>
              </div>
              <div
                className="hidden items-center gap-3 rounded-full border border-[#9ADDEA] bg-[#EAF8FC] px-4 py-2 text-sm font-semibold text-[#0B2A3D] shadow-sm shadow-[#0B2A3D]/5 sm:flex"
              >
                <span className="h-2 w-2 rounded-full bg-[#14B8C6]" />
                Workspace ready
              </div>
            </div>
          </header>

          <main className="coachos-content flex-1 px-5 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>

        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#D8E8F0] bg-white/95 px-3 py-3 shadow-2xl shadow-[#0B2A3D]/10 backdrop-blur-xl lg:hidden">
          <div className="grid grid-cols-5 gap-1">
            {visibleNavItems.slice(0, 5).map((item) => {
              const active = item.label === activeItem;
              const activeStyle = active
                ? ({ backgroundColor: "#EAF7FC" } satisfies CSSProperties)
                : undefined;

              return (
                <Link
                  className={[
                    "flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium",
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
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
