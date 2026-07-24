import { OfficeBetaShell } from "@/app/_components/office-beta-shell";
import { requirePageSession } from "@/server/auth/require-page-session";
import { api } from "@/trpc/server";

export default async function OfficePage() {
  await requirePageSession("/office");

  const snapshot = await api.office.getSnapshot();

  return <OfficeBetaShell snapshot={snapshot} />;
}
