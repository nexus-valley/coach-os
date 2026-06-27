import { AuthCard } from "@/src/components/auth/AuthCard";
import { ResetPasswordForm } from "@/src/components/auth/ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <AuthCard
      eyebrow="Verification required"
      footerHref="/forgot-password"
      footerLabel="Request a new code"
      footerText="Need another verification code?"
      title="Choose a new password"
    >
      <ResetPasswordForm />
    </AuthCard>
  );
}
