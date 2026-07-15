import { ComputeShell } from "@/app/_components/compute-shell";
import { requirePageSession } from "@/server/auth/require-page-session";
import { api } from "@/trpc/server";

export default async function ComputePage() {
  await requirePageSession("/compute");
  const snapshot = await api.compute.getSnapshot();

  return <ComputeShell snapshot={snapshot} />;
}
