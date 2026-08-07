import { AuthCard } from "@/src/components/auth/AuthCard";
import { ResetPasswordForm } from "@/src/components/auth/ResetPasswordForm";
import { getSafeInternalPath } from "@/src/lib/authRedirects";

type ResetPasswordPageProps = {
  searchParams: Promise<{
    email?: string | string[];
    next?: string | string[];
  }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const nextPath = getSafeInternalPath(
    Array.isArray(params.next) ? params.next[0] : params.next,
  );
  const forgotPasswordHref = nextPath
    ? `/forgot-password?next=${encodeURIComponent(nextPath)}`
    : "/forgot-password";

  return (
    <AuthCard
      eyebrow="Verification required"
      footerHref={forgotPasswordHref}
      footerLabel="Request a new code"
      footerText="Need another verification code?"
      title="Choose a new password"
    >
      <ResetPasswordForm />
    </AuthCard>
  );
}
