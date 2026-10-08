export type PlatformCommercialSubscriptionEvidence = {
  commercial_reporting_excluded: boolean;
  commercial_reporting_exclusion: "noncommercial_regression" | null;
};

export type PlatformCommercialTenantDetail = {
  subscription: PlatformCommercialSubscriptionEvidence;
  tenant: {
    id: string;
  };
};

export function isPlatformCommercialReportingExcluded(
  subscription: PlatformCommercialSubscriptionEvidence | null | undefined,
) {
  return (
    subscription?.commercial_reporting_excluded === true &&
    subscription.commercial_reporting_exclusion === "noncommercial_regression"
  );
}

export function derivePlatformTenantCommercialControlState({
  detail,
  detailLoading,
  directorySubscription,
  selectedTenantId,
}: {
  detail: PlatformCommercialTenantDetail | null;
  detailLoading: boolean;
  directorySubscription:
    | PlatformCommercialSubscriptionEvidence
    | null
    | undefined;
  selectedTenantId: string | null;
}) {
  const detailMatchesSelection =
    selectedTenantId !== null && detail?.tenant.id === selectedTenantId;
  const commercialReportingExcluded =
    isPlatformCommercialReportingExcluded(directorySubscription) ||
    (detailMatchesSelection &&
      isPlatformCommercialReportingExcluded(detail.subscription));
  const detailReady =
    selectedTenantId !== null && !detailLoading && detailMatchesSelection;

  return {
    commercialControlsReady: detailReady && !commercialReportingExcluded,
    commercialReportingExcluded,
    detailMatchesSelection,
    detailReady,
  };
}
