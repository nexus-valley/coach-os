"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { Button } from "@/src/components/ui/Button";
import {
  featureListToMap,
  getFeatureStatusLabel,
  getPortalFeatureAccess,
  isFeatureEnabled,
  portalNavFeatureByLabel,
  type FeatureAccessMap,
} from "@/src/lib/featureAccess";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  getSafeTenantBrandColor,
  getTenantSettings,
  getWorkspaceBranding,
  type TenantSettings,
} from "@/src/lib/tenantSettings";
import type { StudentPortalContext } from "@/src/lib/studentPortalAuth";

type StudentPortalLayoutProps = {
  children: React.ReactNode;
  context: StudentPortalContext;
};

const portalNavItems = [
  { href: "/portal", label: "Home" },
  { href: "/portal/courses", label: "My Programs" },
  { href: "/portal/sessions", label: "Live Classes" },
  { href: "/portal/assignments", label: "Assignments" },
  { href: "/portal/notifications", label: "Notifications" },
  { href: "/portal/documents", label: "Materials" },
  { href: "/portal/community", label: "Community" },
  { href: "/portal/announcements", label: "Announcements" },
  { href: "/portal/payments", label: "Payments & Invoices" },
  { href: "/portal/messages", label: "Support" },
  { href: "/portal/profile", label: "Profile" },
];

type PortalBrandStyle = React.CSSProperties & {
  "--portal-brand": string;
  "--portal-brand-foreground": string;
};

function getRelativeLuminance(color: string) {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function getContrastRatio(firstColor: string, secondColor: string) {
  const firstLuminance = getRelativeLuminance(firstColor);
  const secondLuminance = getRelativeLuminance(secondColor);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function getPortalBrandForeground(brandColor: string) {
  return getContrastRatio(brandColor, "#ffffff") >= 4.5
    ? "#ffffff"
    : "#000000";
}

export function StudentPortalLayout({
  children,
  context,
}: StudentPortalLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [featureAccess, setFeatureAccess] = useState<FeatureAccessMap | null>(
    null,
  );
  const [featureAccessLoaded, setFeatureAccessLoaded] = useState(false);
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const portalNavRef = useRef<HTMLElement>(null);
  const portalNavFrameRef = useRef<number | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    let active = true;

    Promise.all([
      getTenantSettings(context.tenant.id),
      getPortalFeatureAccess(context.tenant.id).catch(() => null),
    ])
      .then(([tenantSettings, featureResponse]) => {
        if (active) {
          setSettings(tenantSettings);
          setFeatureAccess(
            featureResponse ? featureListToMap(featureResponse.features) : null,
          );
          setFeatureAccessLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setSettings(null);
          setFeatureAccessLoaded(true);
        }
      });

    return () => {
      active = false;
    };
  }, [context.tenant.id]);

  async function handleLogout() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace("/portal/login");
  }

  const branding = getWorkspaceBranding(settings, context.tenant);
  const brandColor = getSafeTenantBrandColor(
    settings?.student_portal_theme_color || settings?.brand_color,
  );
  const brandForeground = getPortalBrandForeground(brandColor);
  const notificationsFeatureEnabled =
    featureAccessLoaded &&
    Boolean(featureAccess) &&
    isFeatureEnabled(featureAccess, "notifications");
  const visiblePortalNavItems = portalNavItems.filter((item) => {
    const featureKey = portalNavFeatureByLabel[item.label];

    if (featureKey === "notifications") {
      return notificationsFeatureEnabled;
    }

    return isFeatureEnabled(featureAccess, featureKey);
  });
  const visiblePortalNavSignature = visiblePortalNavItems
    .map((item) => item.href)
    .join("|");
  const updatePortalNavOverflow = useCallback(() => {
    const rail = portalNavRef.current;

    if (!rail) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    const maximumScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
    setCanScrollLeft(rail.scrollLeft > 1);
    setCanScrollRight(rail.scrollLeft < maximumScrollLeft - 1);
  }, []);
  const revealActivePortalItem = useCallback(() => {
    const rail = portalNavRef.current;
    const activeLink = rail?.querySelector<HTMLElement>(
      'a[aria-current="page"]',
    );

    if (!rail || !activeLink) {
      updatePortalNavOverflow();
      return;
    }

    const edgeAllowance = 24;
    const railBounds = rail.getBoundingClientRect();
    const activeBounds = activeLink.getBoundingClientRect();
    const maximumScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
    let nextScrollLeft = rail.scrollLeft;

    if (activeBounds.left < railBounds.left + edgeAllowance) {
      nextScrollLeft += activeBounds.left - railBounds.left - edgeAllowance;
    } else if (activeBounds.right > railBounds.right - edgeAllowance) {
      nextScrollLeft += activeBounds.right - railBounds.right + edgeAllowance;
    }

    rail.scrollLeft = Math.max(
      0,
      Math.min(maximumScrollLeft, nextScrollLeft),
    );
    updatePortalNavOverflow();
  }, [updatePortalNavOverflow]);
  const schedulePortalNavReconciliation = useCallback(() => {
    if (portalNavFrameRef.current !== null) {
      window.cancelAnimationFrame(portalNavFrameRef.current);
    }

    portalNavFrameRef.current = window.requestAnimationFrame(() => {
      portalNavFrameRef.current = null;
      revealActivePortalItem();
    });
  }, [revealActivePortalItem]);

  useEffect(() => {
    const rail = portalNavRef.current;
    const resizeObserver = new ResizeObserver(schedulePortalNavReconciliation);

    if (rail) {
      resizeObserver.observe(rail);
    }
    window.addEventListener("resize", schedulePortalNavReconciliation);
    schedulePortalNavReconciliation();

    return () => {
      window.removeEventListener("resize", schedulePortalNavReconciliation);
      if (portalNavFrameRef.current !== null) {
        window.cancelAnimationFrame(portalNavFrameRef.current);
        portalNavFrameRef.current = null;
      }
      resizeObserver.disconnect();
    };
  }, [pathname, schedulePortalNavReconciliation, visiblePortalNavSignature]);
  const activePortalItem = portalNavItems.find(
    (item) =>
      pathname === item.href ||
      (item.href !== "/portal" && pathname?.startsWith(item.href)),
  );
  const activeFeatureKey = activePortalItem
    ? portalNavFeatureByLabel[activePortalItem.label]
    : undefined;
  const activeFeatureStatus = activeFeatureKey
    ? featureAccess?.[activeFeatureKey]?.status
    : undefined;
  const routeFeatureEnabled =
    activeFeatureKey === "notifications"
      ? notificationsFeatureEnabled
      : !featureAccessLoaded || isFeatureEnabled(featureAccess, activeFeatureKey);

  const guardedContent = !featureAccessLoaded ? (
    <section className="rounded-2xl border border-[#D8E8F0] bg-white p-6 text-sm font-medium text-[#5D7185] shadow-sm">
      Checking module access...
    </section>
  ) : !routeFeatureEnabled ? (
    <section className="rounded-2xl border border-[#D8E8F0] bg-white p-8 shadow-sm shadow-[#0B2A3D]/5">
      <div className="max-w-2xl">
        <span className="inline-flex rounded-full border border-[#D8E8F0] bg-[#F3FAFD] px-3 py-1 text-xs font-semibold text-[#425B76]">
          {getFeatureStatusLabel(activeFeatureStatus)}
        </span>
        <h2 className="mt-4 text-2xl font-semibold text-[#0B2A3D]">
          This module is not enabled for your student portal.
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#334155]">
          Your coach has not enabled this portal area. Other available
          portal sections remain accessible from the navigation.
        </p>
      </div>
    </section>
  ) : (
    children
  );

  return (
    <div
      className="min-h-[var(--ui-viewport-height)] bg-[#F8FAFC] text-[#0B1F33]"
      style={
        {
          "--portal-brand": brandColor,
          "--portal-brand-foreground": brandForeground,
        } as PortalBrandStyle
      }
    >
      <header className="sticky top-0 z-30 border-b border-[#D8E8F0] bg-white/90 pt-[var(--ui-safe-area-top)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 py-4 pl-[calc(1.25rem+var(--ui-safe-area-left))] pr-[calc(1.25rem+var(--ui-safe-area-right))] sm:pl-[calc(1.5rem+var(--ui-safe-area-left))] sm:pr-[calc(1.5rem+var(--ui-safe-area-right))] lg:pl-[calc(2rem+var(--ui-safe-area-left))] lg:pr-[calc(2rem+var(--ui-safe-area-right))]">
          <div className="flex items-center justify-between gap-4">
            <Link
              className="flex min-w-0 flex-1 items-center gap-3"
              href="/portal"
            >
              {branding.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={branding.displayName}
                  className="h-11 w-11 shrink-0 rounded-2xl object-cover"
                  src={branding.logoUrl}
                />
              ) : (
                <CoachFortBrandAsset
                  className="h-11 w-11 shrink-0"
                  variant="appIcon"
                />
              )}
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">
                  {branding.displayName}
                </p>
                {branding.showPoweredBy ? (
                  <p className="truncate text-xs font-medium text-[#475569]">
                    powered by CoachFort
                  </p>
                ) : (
                  <p className="truncate text-xs font-medium text-[#475569]">
                    {branding.brandTagline || "Student Portal"}
                  </p>
                )}
              </div>
            </Link>
            <div className="flex shrink-0 items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold">
                  {context.student.full_name}
                </p>
                <p className="text-xs text-[#475569]">Student Portal</p>
              </div>
              <Button
                className="min-h-11 shrink-0"
                onClick={handleLogout}
                size="sm"
                type="button"
                variant="secondary"
              >
                Logout
              </Button>
            </div>
          </div>
          <div className="relative">
            <nav
              aria-label="Student portal navigation"
              className="flex gap-2 overflow-x-auto p-1 scroll-px-6"
              onScroll={updatePortalNavOverflow}
              ref={portalNavRef}
            >
              {visiblePortalNavItems.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/portal" && pathname?.startsWith(item.href));

                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={[
                      "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                      active
                        ? "border-transparent bg-[var(--portal-brand)] text-[var(--portal-brand-foreground)] shadow-md shadow-[#145DA0]/15"
                        : "border-[#CBD5E1] bg-white text-[#334155] hover:border-[#145DA0]/45 hover:text-[#0B2A3D]",
                    ].join(" ")}
                    href={item.href}
                    key={item.href}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            {canScrollLeft ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-4 left-0 top-0 z-10 w-6 bg-[linear-gradient(to_right,rgba(255,255,255,0.98),rgba(255,255,255,0))]"
                data-portal-nav-fade="left"
              />
            ) : null}
            {canScrollRight ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-4 right-0 top-0 z-10 w-6 bg-[linear-gradient(to_left,rgba(255,255,255,0.98),rgba(255,255,255,0))]"
                data-portal-nav-fade="right"
              />
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl pt-6 pb-[calc(1.5rem+var(--ui-safe-area-bottom))] pl-[calc(1.25rem+var(--ui-safe-area-left))] pr-[calc(1.25rem+var(--ui-safe-area-right))] sm:pl-[calc(1.5rem+var(--ui-safe-area-left))] sm:pr-[calc(1.5rem+var(--ui-safe-area-right))] lg:pl-[calc(2rem+var(--ui-safe-area-left))] lg:pr-[calc(2rem+var(--ui-safe-area-right))]">
        {guardedContent}
      </main>
    </div>
  );
}
