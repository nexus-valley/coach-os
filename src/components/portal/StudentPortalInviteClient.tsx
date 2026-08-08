"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { Button } from "@/src/components/ui/Button";
import { FeedbackAlert } from "@/src/components/ui/FeedbackAlert";
import {
  acceptStudentPortalInvitation,
  getStudentPortalInvitationError,
} from "@/src/lib/studentPortalInvitations";
import { shouldClearStudentPortalInvitationToken } from "@/src/lib/studentPortalInvitationAcceptance";
import { getSupabaseClient } from "@/src/lib/supabaseClient";

const inviteReturnPath = "/invite/student";
const tokenStorageKey = "coachfort.student-portal-invitation";
const tokenPattern = /^[A-Za-z0-9_-]{32,160}$/;

type InviteStage =
  | "accepting"
  | "error"
  | "loading"
  | "signed_out"
  | "success";

export function StudentPortalInviteClient() {
  const router = useRouter();
  const startedRef = useRef(false);
  const [errorCode, setErrorCode] = useState("");
  const [message, setMessage] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [stage, setStage] = useState<InviteStage>("loading");

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;

    async function continueInvitation() {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const fragmentToken = fragment.get("token")?.trim() ?? "";

      if (fragmentToken) {
        window.history.replaceState(null, "", inviteReturnPath);

        if (tokenPattern.test(fragmentToken)) {
          window.sessionStorage.setItem(tokenStorageKey, fragmentToken);
        } else {
          window.sessionStorage.removeItem(tokenStorageKey);
        }
      }

      const rawToken = window.sessionStorage.getItem(tokenStorageKey) ?? "";

      if (!tokenPattern.test(rawToken)) {
        window.sessionStorage.removeItem(tokenStorageKey);
        setErrorCode("invitation_unavailable");
        setMessage(
          "This invitation link is not available. Ask your coach to send a new invitation.",
        );
        setStage("error");
        return;
      }

      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        setStage("signed_out");
        return;
      }

      setStage("accepting");

      try {
        await acceptStudentPortalInvitation(rawToken);
        window.sessionStorage.removeItem(tokenStorageKey);
        setStage("success");
        router.replace("/portal");
      } catch (caught) {
        const code = caught instanceof Error ? caught.name : "needs_attention";

        if (shouldClearStudentPortalInvitationToken(code)) {
          window.sessionStorage.removeItem(tokenStorageKey);
        }

        setErrorCode(code);
        setMessage(getStudentPortalInvitationError(caught));
        setStage("error");
      }
    }

    void continueInvitation();
  }, [router]);

  async function handleContinueWithInvitedEmail() {
    const rawToken = window.sessionStorage.getItem(tokenStorageKey) ?? "";

    if (!tokenPattern.test(rawToken)) {
      window.sessionStorage.removeItem(tokenStorageKey);
      setErrorCode("invitation_unavailable");
      setMessage(
        "This invitation link is not available. Ask your coach to send a new invitation.",
      );
      return;
    }

    setSigningOut(true);

    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      window.sessionStorage.setItem(tokenStorageKey, rawToken);
      setErrorCode("");
      setMessage("");
      setStage("signed_out");
      router.replace(inviteReturnPath);
    } catch {
      setMessage(
        "Unable to sign out right now. Your invitation is still available. Please try again.",
      );
    } finally {
      setSigningOut(false);
    }
  }

  const nextPath = encodeURIComponent(inviteReturnPath);
  const canTryAnotherAccount = errorCode === "email_mismatch";

  return (
    <main className="min-h-screen bg-[#071521] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center justify-center">
        <section className="w-full max-w-xl rounded-lg border border-white/10 bg-white p-6 text-[#0B1F33] shadow-2xl shadow-black/30 sm:p-8">
          <CoachFortBrandAsset className="h-12 w-44" variant="fullLogo" />
          <p className="mt-8 text-sm font-semibold text-[#526A80]">
            Student portal invitation
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal">
            Accept your invitation
          </h1>

          {stage === "loading" || stage === "accepting" ? (
            <div aria-live="polite" className="mt-6">
              <FeedbackAlert tone="info">
                {stage === "accepting"
                  ? "Activating your portal access..."
                  : "Checking your invitation..."}
              </FeedbackAlert>
            </div>
          ) : null}

          {stage === "signed_out" ? (
            <div className="mt-6">
              <p className="text-sm leading-6 text-[#425B76]">
                Sign in with the email address that received this invitation. If
                you do not have a CoachFort account yet, create one and verify
                your email to continue.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Button href={`/login?next=${nextPath}`} fullWidth>
                  Sign in to continue
                </Button>
                <Button
                  href={`/signup?next=${nextPath}`}
                  fullWidth
                  variant="secondary"
                >
                  Create account
                </Button>
              </div>
            </div>
          ) : null}

          {stage === "error" ? (
            <div className="mt-6">
              <FeedbackAlert>{message}</FeedbackAlert>
              {canTryAnotherAccount ? (
                <Button
                  className="mt-5"
                  isLoading={signingOut}
                  loadingText="Signing out..."
                  onClick={handleContinueWithInvitedEmail}
                >
                  Continue with invited email
                </Button>
              ) : null}
            </div>
          ) : null}

          {stage === "success" ? (
            <div aria-live="polite" className="mt-6">
              <FeedbackAlert tone="success">
                Access activated. Opening your student portal...
              </FeedbackAlert>
            </div>
          ) : null}

          <p className="mt-8 border-t border-[#D8E8F0] pt-5 text-xs leading-5 text-[#66788F]">
            This invitation activates portal access only. It does not collect a
            payment or change your enrollment payment status.
          </p>
          <p className="mt-3 text-xs text-[#66788F]">
            Need help?{" "}
            <Link className="font-semibold text-[#145DA0]" href="/support">
              Contact CoachFort support
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
