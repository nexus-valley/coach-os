import { InviteAcceptPageClient } from "@/src/components/invitations/InviteAcceptPageClient";

type InvitePageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;

  return <InviteAcceptPageClient token={token} />;
}
