import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";

type AccessDeniedCardProps = {
  description?: string;
  title?: string;
};

export function AccessDeniedCard({
  description = "You do not have permission to access this section.",
  title = "Access denied",
}: AccessDeniedCardProps) {
  return (
    <Card className="mx-auto max-w-3xl border-[#D8E8F0] bg-white p-8 text-center shadow-xl shadow-[#0B2A3D]/10">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-[#9ADDEA] bg-[#EAF8FC] text-lg font-semibold text-[#145DA0]">
        SL
      </div>
      <h1 className="mt-6 text-2xl font-semibold text-[#0B1F33]">{title}</h1>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#425B76]">
        {description}
      </p>
      <div className="mt-6 flex justify-center">
        <Button href="/app" variant="secondary">
          Back to dashboard
        </Button>
      </div>
    </Card>
  );
}
