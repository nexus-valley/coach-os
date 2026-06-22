import Link from "next/link";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { StudentPortalLoginForm } from "@/src/components/portal/StudentPortalLoginForm";

export default function StudentPortalLoginPage() {
  return (
    <main className="min-h-screen bg-[#F3FAFD] text-[#0B1F33]">
      <div className="mx-auto grid min-h-screen max-w-7xl items-center gap-10 px-5 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
        <section className="hidden lg:block">
          <CoachFortBrandAsset className="h-20 w-72" variant="fullLogo" />
          <h1 className="mt-10 text-5xl font-semibold leading-tight tracking-normal">
            Student access for your institute portal.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[#425B76]">
            View your courses, sessions, homework, attendance, certificates,
            payments, and institute updates in a focused student experience.
          </p>
        </section>
        <section className="mx-auto w-full max-w-xl">
          <div className="rounded-[2rem] border border-[#D8E8F0] bg-white p-6 shadow-2xl shadow-[#0B2A3D]/10 sm:p-8">
            <p className="text-sm font-semibold text-[#5D7185]">Student Portal</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal">
              Login as a student
            </h2>
            <div className="mt-8">
              <StudentPortalLoginForm />
            </div>
            <p className="mt-8 text-center text-sm text-[#5D7185]">
              Team member?{" "}
              <Link
                className="font-semibold text-[#0B2A3D] underline-offset-4 hover:underline"
                href="/login"
              >
                Login to workspace
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
