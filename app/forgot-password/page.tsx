import { AuthCard } from "@/src/components/auth/AuthCard";
import { ForgotPasswordForm } from "@/src/components/auth/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      eyebrow="Account recovery"
      footerHref="/login"
      footerLabel="Back to login"
      footerText="Remembered your password?"
      title="Reset your CoachFort password"
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
