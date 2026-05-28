import {
  seedDemoWorkspace,
  type DemoSeedSummary,
} from "@/src/lib/demoWorkspace";

export type DemoSeedResult = DemoSeedSummary;

export async function loadDemoDataForTenant(
  tenantId: string,
): Promise<DemoSeedResult> {
  const result = await seedDemoWorkspace(tenantId);
  return result.summary;
}
