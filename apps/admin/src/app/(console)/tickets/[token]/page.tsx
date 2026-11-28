import { TicketDetailPageClient } from "@/components/ticket-detail-page-client";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function TicketDetailPage({ params }: PageProps) {
  const { token } = await params;
  return <TicketDetailPageClient token={token} />;
}