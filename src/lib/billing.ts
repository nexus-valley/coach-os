import { getInvoices, getPaymentHistory } from "@/src/lib/invoices";
import {
  getCurrentSubscription,
  getSubscriptionAccessState,
} from "@/src/lib/subscriptions";

export async function getBillingSummary(tenantId: string) {
  const [subscription, invoices, paymentHistory] = await Promise.all([
    getCurrentSubscription(tenantId),
    getInvoices(tenantId),
    getPaymentHistory(tenantId),
  ]);

  return {
    accessState: getSubscriptionAccessState(subscription),
    invoices,
    paymentHistory,
    subscription,
  };
}
