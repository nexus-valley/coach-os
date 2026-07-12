"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  { href: "/portal", label: "Overview" },
  { href: "/portal/announcements", label: "Announcements" },
  { href: "/portal/community", label: "Community" },
  { href: "/portal/courses", label: "Courses" },
  { href: "/portal/sessions", label: "Sessions" },
  { href: "/portal/assignments", label: "Assignments" },
  { href: "/portal/certificates", label: "Certificates" },
  { href: "/portal/payments", label: "Payments" },
  { href: "/portal/messages", label: "Messages" },
  { href: "/portal/documents", label: "Documents" },
  { href: "/portal/notifications", label: "Notifications" },
  { href: "/portal/assistant", label: "Assistant" },
  { href: "/portal/profile", label: "Profile" },
];

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
  const visiblePortalNavItems = portalNavItems.filter((item) =>
    isFeatureEnabled(featureAccess, portalNavFeatureByLabel[item.label]),
  );
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
    !featureAccessLoaded || isFeatureEnabled(featureAccess, activeFeatureKey);

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
        <p className="mt-3 text-sm leading-6 text-[#5D7185]">
          Your institute has not enabled this portal area. Other available
          portal sections remain accessible from the navigation.
        </p>
      </div>
    </section>
  ) : (
    children
  );

  return (
    <div
      className="min-h-screen bg-[#F3FAFD] text-[#0B1F33]"
      style={{ "--portal-brand": brandColor } as React.CSSProperties}
    >
      <header className="sticky top-0 z-30 border-b border-[#D8E8F0] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <Link className="flex min-w-0 items-center gap-3" href="/portal">
              {branding.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={branding.displayName}
                  className="h-11 w-11 rounded-2xl object-cover"
                  src={branding.logoUrl}
                />
              ) : (
                <CoachFortBrandAsset className="h-11 w-11" variant="appIcon" />
              )}
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">
                  {branding.displayName}
                </p>
                {branding.showPoweredBy ? (
                  <p className="text-xs font-medium text-[#5D7185]">
                    powered by CoachFort
                  </p>
                ) : (
                  <p className="text-xs font-medium text-[#5D7185]">
                    {branding.brandTagline || "Student Portal"}
                  </p>
                )}
              </div>
            </Link>
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold">
                  {context.student.full_name}
                </p>
                <p className="text-xs text-[#66788F]">Student Portal</p>
              </div>
              <Button onClick={handleLogout} size="sm" type="button" variant="secondary">
                Logout
              </Button>
            </div>
          </div>
          <nav className="flex gap-2 overflow-x-auto pb-1">
            {visiblePortalNavItems.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/portal" && pathname?.startsWith(item.href));

              return (
                <Link
                  className={[
                    "whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition",
                    active
                      ? "border-transparent text-white shadow-md shadow-[#145DA0]/15"
                      : "border-[#D8E8F0] bg-white text-[#425B76] hover:border-[#2ECBEA]/60 hover:text-[#0B2A3D]",
                  ].join(" ")}
                  href={item.href}
                  key={item.href}
                  style={
                    active
                      ? {
                          backgroundColor: brandColor,
                          boxShadow: `0 10px 18px ${brandColor}26`,
                        }
                      : undefined
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-6 sm:px-6 lg:px-8">
        {guardedContent}
      </main>
    </div>
  );
}
