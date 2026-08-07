import { AuthCard } from "@/src/components/auth/AuthCard";
import { ForgotPasswordForm } from "@/src/components/auth/ForgotPasswordForm";
import { getSafeInternalPath } from "@/src/lib/authRedirects";

type ForgotPasswordPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = await searchParams;
  const nextPath = getSafeInternalPath(
    Array.isArray(params.next) ? params.next[0] : params.next,
  );
  const loginHref = nextPath
    ? `/login?next=${encodeURIComponent(nextPath)}`
    : "/login";

  return (
    <AuthCard
      eyebrow="Account recovery"
      footerHref={loginHref}
      footerLabel="Back to login"
      footerText="Remembered your password?"
      title="Reset your CoachFort password"
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
