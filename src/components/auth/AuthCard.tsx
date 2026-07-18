import Link from "next/link";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { EarlyAccessNotice } from "@/src/components/marketing/EarlyAccessNotice";

type AuthCardProps = {
  children: React.ReactNode;
  eyebrow: string;
  footerHref: string;
  footerLabel: string;
  footerText: string;
  title: string;
};

export function AuthCard({
  children,
  eyebrow,
  footerHref,
  footerLabel,
  footerText,
  title,
}: AuthCardProps) {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.18),transparent_30rem),linear-gradient(135deg,rgba(63,63,70,0.28),transparent_36rem)]" />
      <div className="relative">
        <EarlyAccessNotice
          className="border-b border-white/10 bg-zinc-900/80"
          tone="dark"
        />
      </div>
      <div className="relative mx-auto grid min-h-[calc(100vh-4.5rem)] max-w-7xl items-center gap-10 px-5 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
        <section className="hidden lg:block">
          <div className="max-w-xl">
            <CoachFortBrandAsset
              className="h-20 w-72"
              variant="fullLogo"
            />
            <h1 className="mt-10 text-5xl font-semibold leading-tight tracking-normal">
              Premium white-label workspace for modern coaching teams.
            </h1>
            <p className="mt-6 text-lg leading-8 text-zinc-400">
              Sign in or continue from an invitation to manage programs,
              enrollment requests, student access, live delivery, Finance
              Center records, communication, and analytics.
            </p>
          </div>
        </section>

        <section className="mx-auto w-full max-w-xl">
          <div className="rounded-[2rem] border border-white/10 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/30 sm:p-8">
            <div>
              <p className="text-sm font-semibold text-zinc-500">{eyebrow}</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-normal">
                {title}
              </h2>
            </div>

            <div className="mt-8">{children}</div>

            <p className="mt-8 text-center text-sm text-zinc-500">
              {footerText}{" "}
              <Link
                className="font-semibold text-zinc-950 underline-offset-4 hover:underline"
                href={footerHref}
              >
                {footerLabel}
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
