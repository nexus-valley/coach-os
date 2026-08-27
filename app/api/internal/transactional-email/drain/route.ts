import { handleTransactionalEmailDrainRequest } from "@/src/lib/server/transactionalEmailDrain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Production activation gate: upgrade to minute-cron support, configure
// CRON_SECRET, add this GET route to Vercel Cron at "* * * * *", redeploy,
// then run the scheduler production smoke.
export async function GET(request: Request) {
  return handleTransactionalEmailDrainRequest(request, {
    configuredSecret: process.env.CRON_SECRET,
    minimumSecretLength: 32,
    operation: "transactional_email_cron_drain",
  });
}

export async function POST(request: Request) {
  return handleTransactionalEmailDrainRequest(request, {
    configuredSecret: process.env.COACHFORT_EMAIL_WORKER_SECRET,
    operation: "transactional_email_drain",
  });
}
