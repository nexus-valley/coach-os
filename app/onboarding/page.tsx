import { OnboardingForm } from "@/src/components/auth/OnboardingForm";
import { RouteGuard } from "@/src/components/auth/RouteGuard";
import { Badge } from "@/src/components/ui/Badge";

export default function OnboardingPage() {
  return (
    <RouteGuard mode="onboarding">
      <main className="min-h-screen bg-zinc-950 text-white">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_32rem),linear-gradient(135deg,rgba(39,39,42,0.55),transparent_34rem)]" />
        <div className="relative mx-auto grid min-h-screen max-w-7xl items-center gap-10 px-5 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <section>
            <Badge className="border-white/15 bg-white/10 text-white">
              Tenant onboarding
            </Badge>
            <h1 className="mt-6 max-w-2xl text-5xl font-semibold leading-tight tracking-normal">
              Create the workspace that will run your coaching business.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-zinc-400">
              Every coach, coaching business, or team starts as its own secure
              workspace. After workspace creation, CoachFort will guide you through
              billing readiness, team invites, students, courses, documents,
              announcements, and community setup.
            </p>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-white p-6 text-zinc-950 shadow-2xl shadow-black/30 sm:p-8">
            <p className="text-sm font-semibold text-zinc-500">
              First workspace
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal">
              Set up your workspace
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              This creates the secure workspace only. It does not start
              checkout, change a plan, send invites, or publish student-facing
              content.
            </p>
            <OnboardingForm />
          </section>
        </div>
      </main>
    </RouteGuard>
  );
}
