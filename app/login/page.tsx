import { AuthCard } from "@/src/components/auth/AuthCard";
import { LoginForm } from "@/src/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <AuthCard
      eyebrow="Secure access"
      footerHref="/signup"
      footerLabel="Early access signup"
      footerText="New to CoachFort?"
      title="Login to CoachFort"
    >
      <LoginForm />
    </AuthCard>
  );
}
