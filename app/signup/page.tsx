import { AuthCard } from "@/src/components/auth/AuthCard";
import { SignupForm } from "@/src/components/auth/SignupForm";

export default function SignupPage() {
  return (
    <AuthCard
      eyebrow="Start your workspace"
      footerHref="/login"
      footerLabel="Login"
      footerText="Already have an account?"
      title="Create your CoachOS account"
    >
      <SignupForm />
    </AuthCard>
  );
}
