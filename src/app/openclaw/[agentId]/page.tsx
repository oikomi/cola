import { notFound } from "next/navigation";

import { AgentWorkspace } from "@/app/_components/agent-workspace";
import { requirePageSession } from "@/server/auth/require-page-session";
import { api } from "@/trpc/server";

export default async function OpenClawAgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  await requirePageSession(`/openclaw/${agentId}`);

  const snapshot = await api.office.getSnapshot();
  const agent = snapshot.agents.find((item) => item.id === agentId);

  if (!agent || agent.engine === "hermes-agent") {
    notFound();
  }

  return (
    <AgentWorkspace snapshot={snapshot} agentId={agentId} engine="openclaw" />
  );
}
