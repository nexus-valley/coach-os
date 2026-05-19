"use client";

import { useState } from "react";

import { signInWithGoogle } from "@/src/lib/auth";

type GoogleOAuthButtonProps = {
  disabled?: boolean;
  onError: (message: string) => void;
  redirectPath?: string;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Unable to continue with Google. Please try again.";
}

export function GoogleOAuthButton({
  disabled = false,
  onError,
  redirectPath,
}: GoogleOAuthButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleGoogleLogin() {
    setLoading(true);
    onError("");

    try {
      await signInWithGoogle(redirectPath);
    } catch (caught) {
      onError(getErrorMessage(caught));
      setLoading(false);
    }
  }

  return (
    <button
      className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-full border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
      disabled={disabled || loading}
      onClick={handleGoogleLogin}
      type="button"
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-sm font-bold text-zinc-950"
      >
        G
      </span>
      {loading ? "Redirecting to Google..." : "Continue with Google"}
    </button>
  );
}
