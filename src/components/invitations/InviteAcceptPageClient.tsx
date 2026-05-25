"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CoachFortBrandAsset } from "@/src/components/branding/CoachFortBrandAsset";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { getSupabaseClient } from "@/src/lib/supabaseClient";
import {
  acceptTeamInvitation,
  getInvitationByToken,
  getTeamInvitationErrorMessage,
  logTeamInvitationError,
  type TeamInvitationPreview,
} from "@/src/lib/teamInvitations";

type InviteAcceptPageClientProps = {
  token: string;
};

function formatRole(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getErrorMessage(caught: unknown, fallback: string) {
  return getTeamInvitationErrorMessage(caught, fallback);
}

export function InviteAcceptPageClient({ token }: InviteAcceptPageClientProps) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const [invitation, setInvitation] = useState<TeamInvitationPreview | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  const nextPath = useMemo(
    () => `/invite/${encodeURIComponent(token)}`,
    [token],
  );
  const authQuery = useMemo(
    () => `?next=${encodeURIComponent(nextPath)}`,
    [nextPath],
  );

  const loadInvitation = useCallback(async () => {
    setError("");
    setLoading(true);

    try {
      const supabase = getSupabaseClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        setSignedIn(false);
        setInvitation(null);
        return;
      }

      setSignedIn(true);
      setUserEmail(user.email ?? "");
      setInvitation(await getInvitationByToken(token));
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to load this invitation."));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(() => loadInvitation());
  }, [loadInvitation]);

  async function handleAcceptInvitation() {
    setAccepting(true);
    setError("");

    try {
      await acceptTeamInvitation(token);
      router.replace("/app");
    } catch (caught) {
      logTeamInvitationError("Accept invitation button failed", caught);
      setError(getErrorMessage(caught, "Unable to accept this invitation."));
    } finally {
      setAccepting(false);
    }
  }

  const status = invitation?.status;
  const canAccept = status === "pending";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(46,203,234,0.2),transparent_30rem),linear-gradient(135deg,#F3FAFD_0%,#FFFFFF_52%,#EAF7FC_100%)] px-5 py-10 text-[#0B1F33]">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center">
        <Card className="w-full p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CoachFortBrandAsset
                className="h-14 w-48"
                variant="fullLogo"
              />
              <Badge className="mt-6">Team Invitation</Badge>
              <h1 className="mt-5 text-3xl font-semibold tracking-normal text-[#0B1F33] sm:text-4xl">
                {invitation
                  ? `Join ${invitation.tenant_name}`
                  : "Join a CoachFort workspace"}
              </h1>
            </div>
            {status ? <Badge tone={status === "pending" ? "success" : "warning"}>{status}</Badge> : null}
          </div>

          {loading ? (
            <div className="mt-8 rounded-3xl border border-[#D8E8F0] bg-[#F6FBFE] p-6">
              <div className="h-4 w-44 animate-pulse rounded-full bg-[#D8E8F0]" />
              <div className="mt-4 h-4 w-64 animate-pulse rounded-full bg-[#D8E8F0]" />
              <div className="mt-4 h-11 w-36 animate-pulse rounded-full bg-[#D8E8F0]" />
            </div>
          ) : null}

          {!loading && !signedIn ? (
            <div className="mt-8 rounded-3xl border border-[#D8E8F0] bg-[#F6FBFE] p-6">
              <h2 className="text-xl font-semibold">Sign in to continue</h2>
              <p className="mt-3 leading-7 text-[#425B76]">
                For security, invitation details are shown only after you sign
                in with the invited email address.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button href={`/login${authQuery}`}>Sign in</Button>
                <Button href={`/signup${authQuery}`} variant="secondary">
                  Sign up
                </Button>
              </div>
            </div>
          ) : null}

          {!loading && signedIn && !invitation ? (
            <div className="mt-8 rounded-3xl border border-orange-200 bg-orange-50 p-6 text-orange-950">
              <h2 className="text-xl font-semibold">
                Invitation unavailable
              </h2>
              <p className="mt-3 leading-7 text-orange-800">
                This invite may be expired, revoked, already accepted, or tied
                to a different email. You are signed in as{" "}
                <span className="font-semibold">{userEmail}</span>.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button href="/login" variant="secondary">
                  Switch account
                </Button>
                <Button href="/" variant="ghost">
                  Back to home
                </Button>
              </div>
            </div>
          ) : null}

          {!loading && invitation ? (
            <div className="mt-8 rounded-3xl border border-[#D8E8F0] bg-[#F6FBFE] p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-semibold text-[#66788F]">
                    Workspace
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {invitation.tenant_name}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#66788F]">
                    Invited email
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {invitation.email}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#66788F]">Role</p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatRole(invitation.role)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#66788F]">
                    Expires
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {formatDate(invitation.expires_at)}
                  </p>
                </div>
              </div>

              {canAccept ? (
                <div className="mt-7">
                  <Button
                    disabled={accepting}
                    onClick={handleAcceptInvitation}
                    type="button"
                  >
                    {accepting ? "Accepting..." : "Accept invitation"}
                  </Button>
                </div>
              ) : (
                <p className="mt-7 rounded-2xl border border-[#D8E8F0] bg-white p-4 text-sm font-medium text-[#425B76]">
                  This invitation is {status}. Contact your workspace owner or
                  admin if you need a new invite.
                </p>
              )}
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <p className="mt-6 text-sm text-[#66788F]">
            Already joined?{" "}
            <Link className="font-semibold text-[#145DA0]" href="/app">
              Open CoachFort
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}
