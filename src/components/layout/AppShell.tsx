"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";

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
  children: React.ReactNode;
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
  { href: "/app/subscription", label: "Subscription" },
  { href: "/app/settings", label: "Settings" },
];

const iconMap: Record<string, string> = {
  Analytics: "AN",
  Automations: "AU",
  Cohorts: "CO",
  Courses: "CU",
  Dashboard: "DB",
  Enrollments: "EN",
  Payments: "PY",
  "Payment Links": "PL",
  Portal: "PO",
  Reminders: "RM",
  Reports: "RP",
  Settings: "ST",
  Students: "SD",
  Subscription: "SU",
};

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

  const brandBadgeStyle = {
    borderColor: `${brandColor}66`,
    color: brandColor,
  } satisfies CSSProperties;
  const visibleNavItems = navItems.filter(
    (item) => !(currentRole === "staff" && item.label === "Subscription"),
  );

  return (
    <div className="min-h-screen bg-[#050607] text-white" style={shellStyle}>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.14),transparent_30rem),linear-gradient(135deg,rgba(15,23,42,0.38),transparent_34rem)]" />

      <div className="relative flex min-h-screen">
        <aside className="hidden w-72 shrink-0 border-r border-white/10 bg-[#101214] px-4 py-5 backdrop-blur-xl lg:block">
          <Link className="flex items-center gap-3 px-2" href="/app">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-400 text-sm font-bold text-black">
              CO
            </span>
            <div>
              <p className="text-base font-semibold">CoachOS</p>
              <p className="text-xs text-slate-400">Nexus Valley</p>
            </div>
          </Link>

          <nav className="mt-10 space-y-1">
            {visibleNavItems.map((item) => {
              const active = item.label === activeItem;
              const className = [
                "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition",
                active
                  ? "text-black shadow-lg shadow-teal-950/30"
                  : "text-slate-300 hover:bg-white/10 hover:text-white",
              ].join(" ");
              const activeStyle = active
                ? ({ backgroundColor: brandColor } satisfies CSSProperties)
                : undefined;
              const content = (
                <>
                  <span
                    className={[
                      "flex h-8 w-8 items-center justify-center rounded-xl text-[10px] font-bold",
                      active
                        ? "bg-black text-teal-300"
                        : "bg-white/10 text-slate-300",
                    ].join(" ")}
                  >
                    {iconMap[item.label]}
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

        <div className="flex min-w-0 flex-1 flex-col pb-24 lg:pb-0">
          <header className="sticky top-0 z-20 border-b border-white/10 bg-[#050607]/85 backdrop-blur-xl">
            <div className="flex h-20 items-center justify-between px-5 sm:px-6 lg:px-8">
              <div>
                <p className="text-xs font-semibold text-slate-400">
                  Nexus Valley
                </p>
                <h1 className="mt-1 text-xl font-semibold text-white">
                  CoachOS
                </h1>
              </div>
              <div
                className="hidden items-center gap-3 rounded-full border bg-white/5 px-4 py-2 text-sm sm:flex"
                style={brandBadgeStyle}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: brandColor }}
                />
                Workspace ready
              </div>
            </div>
          </header>

          <main className="flex-1 px-5 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>

        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#050607]/95 px-3 py-3 backdrop-blur-xl lg:hidden">
          <div className="grid grid-cols-5 gap-1">
            {visibleNavItems.slice(0, 5).map((item) => {
              const active = item.label === activeItem;
              const activeStyle = active
                ? ({ backgroundColor: brandColor } satisfies CSSProperties)
                : undefined;

              return (
                <Link
                  className={[
                    "flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium",
                    active
                      ? "text-black"
                      : "text-slate-300 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                  href={item.href}
                  key={item.label}
                  style={activeStyle}
                >
                  <span className="text-[10px] font-bold">
                    {iconMap[item.label]}
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
