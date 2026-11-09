import { Suspense } from "react";
import { redirect } from "next/navigation";

type RouteProps = { params: Promise<{ conversationId: string }> };

async function LegacyConversationRedirect({ params }: RouteProps): Promise<never> {
  const { conversationId } = await params;
  redirect(`/chat/${conversationId}`);
}

export default function LegacyConversationChatPage({ params }: RouteProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#07111b]" />}>
      <LegacyConversationRedirect params={params} />
    </Suspense>
  );
}
