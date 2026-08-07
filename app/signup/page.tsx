import { AuthCard } from "@/src/components/auth/AuthCard";
import { SignupForm } from "@/src/components/auth/SignupForm";
import { getSafeInternalPath } from "@/src/lib/authRedirects";

type SignupPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const nextPath = getSafeInternalPath(
    Array.isArray(params.next) ? params.next[0] : params.next,
  );
  const loginHref = nextPath
    ? `/login?next=${encodeURIComponent(nextPath)}`
    : "/login";

  return (
    <AuthCard
      eyebrow="Start your workspace"
      footerHref={loginHref}
      footerLabel="Login"
      footerText="Already have an account?"
      title="Create your CoachFort account"
    >
      <SignupForm />
    </AuthCard>
  );
}
