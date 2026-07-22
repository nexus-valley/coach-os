"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/src/components/ui/Button";
import {
  coachingCategories,
  createWorkspace,
  type CoachingCategory,
} from "@/src/lib/tenant";

export function OnboardingForm() {
  const router = useRouter();
  const [category, setCategory] = useState<CoachingCategory>(
    "Business Coaching",
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await createWorkspace({
        category,
        name: workspaceName,
      });
      router.replace("/app");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to create your workspace. Please try again.",
      );
      setLoading(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">
          Workspace name
        </span>
        <input
          className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
          onChange={(event) => setWorkspaceName(event.target.value)}
          placeholder="Nexus Valley Coaching"
          required
          type="text"
          value={workspaceName}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">
          Coaching category
        </span>
        <select
          className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
          onChange={(event) =>
            setCategory(event.target.value as CoachingCategory)
          }
          value={category}
        >
          {coachingCategories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Button className="w-full" disabled={loading} size="lg" type="submit">
        {loading ? "Creating workspace..." : "Create workspace"}
      </Button>
    </form>
  );
}
