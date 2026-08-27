import { Badge } from "@/src/components/ui/Badge";
import { FormField } from "@/src/components/ui/FormField";
import type { CommunityCreateScope } from "@/src/lib/community";

export function CommunitySpaceSelector({
  id,
  onChange,
  selectedKey,
  spaces,
}: {
  id: string;
  onChange: (key: string) => void;
  selectedKey: string;
  spaces: CommunityCreateScope[];
}) {
  const selected = spaces.find((space) => space.key === selectedKey) ?? null;

  return (
    <section
      aria-label="Community space"
      className="border-y border-[#D8E8F0] bg-[#F8FBFD] px-4 py-4 sm:px-5"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <FormField
          className="w-full lg:max-w-xl"
          description={
            spaces.length === 0
              ? "No Program or Cohort Community space is available in your current scope."
              : "Choose the exact Program or Cohort discussion space."
          }
          htmlFor={id}
          label="Community space"
        >
          <select
            className="h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm text-[#0B1F33] outline-none focus:border-[#2ECBEA] focus:ring-4 focus:ring-[#2ECBEA]/10"
            disabled={spaces.length === 0}
            id={id}
            onChange={(event) => onChange(event.target.value)}
            value={selectedKey}
          >
            <option value="">
              {spaces.length === 0 ? "No Community spaces available" : "Choose a Community space"}
            </option>
            {spaces.map((space) => (
              <option key={space.key} value={space.key}>
                {space.label}
              </option>
            ))}
          </select>
        </FormField>

        <div aria-live="polite" className="min-h-11 text-sm text-[#425B76] lg:max-w-md">
          {selected ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={selected.kind === "cohort" ? "trainer" : "info"}>
                {selected.kind === "cohort" ? "Cohort" : "Program"}
              </Badge>
              {!selected.canWrite ? <Badge tone="neutral">Read only</Badge> : null}
              <p className="w-full leading-6 sm:w-auto sm:flex-1">{selected.description}</p>
            </div>
          ) : spaces.length > 1 ? (
            <p className="leading-6">Select a space to load its focused Community feed.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
