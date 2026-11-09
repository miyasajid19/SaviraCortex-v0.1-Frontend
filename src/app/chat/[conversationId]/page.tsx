import { Suspense } from "react";
import ChatWorkspacePage from "../../../components/chat/ChatWorkspacePage";

type RouteProps = { params: Promise<{ conversationId: string }> };

async function ConversationChatContent({ params }: RouteProps) {
  const { conversationId } = await params;
  return <ChatWorkspacePage conversationId={conversationId} />;
}

export default function ConversationChatPage({ params }: RouteProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#07111b]" />}>
      <ConversationChatContent params={params} />
    </Suspense>
  );
}
