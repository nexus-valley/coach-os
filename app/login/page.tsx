import { AuthCard } from "@/src/components/auth/AuthCard";
import { LoginForm } from "@/src/components/auth/LoginForm";
import { getSafeInternalPath } from "@/src/lib/authRedirects";

type LoginPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = getSafeInternalPath(
    Array.isArray(params.next) ? params.next[0] : params.next,
  );
  const signupHref = nextPath
    ? `/signup?next=${encodeURIComponent(nextPath)}`
    : "/signup";

  return (
    <AuthCard
      eyebrow="Secure access"
      footerHref={signupHref}
      footerLabel="Create an account"
      footerText="New to CoachFort?"
      title="Login to CoachFort"
    >
      <LoginForm />
    </AuthCard>
  );
}
