"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/src/components/ui/Button";
import {
  coachingCategories,
  createWorkspace,
  type CoachingCategory,
} from "@/src/lib/tenant";
import {
  defaultTenantBrandColor,
  updateTenantSettings,
} from "@/src/lib/tenantSettings";

type BrandedPagePreference = "coachfort-hosted" | "custom-domain-later" | "skip";
type PlanInterest = "starter" | "growth" | "premium" | "skip";

const steps = [
  {
    description: "Confirm the workspace name your team will see in CoachFort.",
    title: "Basic profile",
  },
  {
    description: "Add a short public-page starting point, or skip it for later.",
    title: "Coaching business details",
  },
  {
    description: "Choose the category that best matches your coaching business.",
    title: "Coaching category",
  },
  {
    description: "Pick how you want to start your CoachFort-hosted branded page.",
    title: "Branded page preference",
  },
  {
    description: "Review Starter, Growth, and Premium boundaries before setup.",
    title: "Subscription plan awareness",
  },
  {
    description: "Create the workspace and continue into the dashboard.",
    title: "Finish",
  },
] as const;

const brandedPageOptions: {
  description: string;
  label: string;
  value: BrandedPagePreference;
}[] = [
  {
    description:
      "Start with a branded page under coachfort.com, for example coachfort.com/site/your-coaching-brand.",
    label: "Use a CoachFort-hosted branded page",
    value: "coachfort-hosted",
  },
  {
    description:
      "Custom domains will be a separate paid add-on with assisted setup. We will keep this as a preference for now.",
    label: "I am interested in using my own domain later",
    value: "custom-domain-later",
  },
  {
    description: "You can set up your public page later from Settings.",
    label: "Skip for now",
    value: "skip",
  },
];

const planInterestOptions: {
  description: string;
  label: string;
  value: PlanInterest;
}[] = [
  {
    description:
      "Best for small coaches starting out: ₹1,499/month or ₹14,990/year, up to 100 students and 5 programs.",
    label: "Interested in Starter",
    value: "starter",
  },
  {
    description:
      "Best for growing coaching businesses: ₹5,999/month or ₹59,990/year, up to 1,000 students and 25 programs.",
    label: "Interested in Growth",
    value: "growth",
  },
  {
    description:
      "Custom scope and activation review. Premium is not self-serve during soft launch.",
    label: "Talk to us about Premium",
    value: "premium",
  },
  {
    description: "Review plans later from the dashboard or with CoachFort support.",
    label: "Skip for now",
    value: "skip",
  },
];

function OptionChoice<T extends string>({
  checked,
  description,
  label,
  name,
  onChange,
  value,
}: {
  checked: boolean;
  description: string;
  label: string;
  name: string;
  onChange: (value: T) => void;
  value: T;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 transition hover:border-[#145DA0]/40 hover:bg-white">
      <input
        checked={checked}
        className="mt-1 h-4 w-4 accent-[#145DA0]"
        name={name}
        onChange={() => onChange(value)}
        type="radio"
      />
      <span>
        <span className="block text-sm font-semibold text-zinc-950">
          {label}
        </span>
        <span className="mt-1 block text-xs leading-5 text-zinc-500">
          {description}
        </span>
      </span>
    </label>
  );
}

function getOptionalSettingsInput(workspaceName: string, businessDescription: string) {
  const trimmedDescription = businessDescription.trim();

  if (!trimmedDescription) {
    return null;
  }

  return {
    addressLine1: "",
    addressLine2: "",
    brandColor: defaultTenantBrandColor,
    brandName: workspaceName,
    brandTagline: "",
    certificateIssuerName: "",
    city: "",
    contactCtaText: "",
    country: "",
    logoUrl: "",
    postalCode: "",
    publicPageDescription: trimmedDescription,
    publicPageTitle: "",
    receiptFooterText: "",
    state: "",
    supportEmail: "",
    supportPhone: "",
    websiteUrl: "",
    whatsappNumber: "",
    workspaceDisplayName: workspaceName,
  };
}

export function OnboardingForm() {
  const router = useRouter();
  const [category, setCategory] = useState<CoachingCategory>(
    "Business / entrepreneurship coaching",
  );
  const [brandedPagePreference, setBrandedPagePreference] =
    useState<BrandedPagePreference>("coachfort-hosted");
  const [businessDescription, setBusinessDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [otherCategory, setOtherCategory] = useState("");
  const [planInterest, setPlanInterest] = useState<PlanInterest>("starter");
  const [stepIndex, setStepIndex] = useState(0);
  const [workspaceName, setWorkspaceName] = useState("");

  const isLastStep = stepIndex === steps.length - 1;
  const currentStep = steps[stepIndex];

  function goBack() {
    setError("");
    setStepIndex((current) => Math.max(0, current - 1));
  }

  function validateCurrentStep() {
    if (stepIndex === 0 && !workspaceName.trim()) {
      return "Workspace name is required.";
    }

    return "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const validationError = validateCurrentStep();

    if (validationError) {
      setError(validationError);
      return;
    }

    if (!isLastStep) {
      setStepIndex((current) => Math.min(steps.length - 1, current + 1));
      return;
    }

    setLoading(true);

    try {
      const workspace = await createWorkspace({
        category,
        name: workspaceName.trim(),
      });

      const optionalSettingsInput = getOptionalSettingsInput(
        workspaceName.trim(),
        businessDescription,
      );

      if (optionalSettingsInput) {
        try {
          await updateTenantSettings(workspace.id, optionalSettingsInput);
        } catch (caught) {
          console.warn("[CoachFort onboarding] Optional public page description was not saved", {
            message:
              caught instanceof Error
                ? caught.message
                : "Unknown settings update error",
          });
        }
      }

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
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
          Step {stepIndex + 1} of {steps.length}
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-normal text-zinc-950">
          {currentStep.title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          {currentStep.description}
        </p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-[#145DA0] transition-all"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {stepIndex === 0 ? (
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
          <span className="mt-2 block text-xs leading-5 text-zinc-500">
            Use the coaching brand or business name your students recognize.
          </span>
        </label>
      ) : null}

      {stepIndex === 1 ? (
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">
            Tell us a few words about your coaching business
          </span>
          <textarea
            className="mt-2 min-h-28 w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
            maxLength={220}
            onChange={(event) => setBusinessDescription(event.target.value)}
            placeholder="Example: Practical career coaching for early-stage product managers."
            value={businessDescription}
          />
          <span className="mt-2 block text-xs leading-5 text-zinc-500">
            Optional. This can be used as a starting point for your
            CoachFort-hosted public page and edited later from public page
            settings.
          </span>
        </label>
      ) : null}

      {stepIndex === 2 ? (
        <div className="space-y-4">
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
          {category === "Other" ? (
            <label className="block">
              <span className="text-sm font-medium text-zinc-700">
                Other category note
              </span>
              <input
                className="mt-2 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/10"
                onChange={(event) => setOtherCategory(event.target.value)}
                placeholder="Describe your coaching category"
                type="text"
                value={otherCategory}
              />
              <span className="mt-2 block text-xs leading-5 text-zinc-500">
                We will create the workspace under Other for now. You can
                refine this with CoachFort support later.
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      {stepIndex === 3 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-zinc-700">
            Choose how you want to start your branded page
          </p>
          {brandedPageOptions.map((option) => (
            <OptionChoice
              checked={brandedPagePreference === option.value}
              description={option.description}
              key={option.value}
              label={option.label}
              name="branded-page-preference"
              onChange={setBrandedPagePreference}
              value={option.value}
            />
          ))}
        </div>
      ) : null}

      {stepIndex === 4 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-zinc-700">
            Subscription plan awareness
          </p>
          {planInterestOptions.map((option) => (
            <OptionChoice
              checked={planInterest === option.value}
              description={option.description}
              key={option.value}
              label={option.label}
              name="plan-interest"
              onChange={setPlanInterest}
              value={option.value}
            />
          ))}
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
            This step records guidance only. It does not start checkout, collect
            payment, activate a plan, or enable Premium.
          </p>
        </div>
      ) : null}

      {stepIndex === 5 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-950">
          <p className="font-semibold">Your workspace is ready to create.</p>
          <p className="mt-2">
            After creation, review your dashboard, set up your public page, and
            create your first program. Student payments stay coach-managed until
            payment gateway workflows are intentionally enabled.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          disabled={loading || stepIndex === 0}
          onClick={goBack}
          size="lg"
          type="button"
          variant="secondary"
        >
          Back
        </Button>
        <Button className="sm:min-w-48" disabled={loading} size="lg" type="submit">
          {loading
            ? "Creating workspace..."
            : isLastStep
              ? "Create workspace"
              : "Continue"}
        </Button>
      </div>
    </form>
  );
}
