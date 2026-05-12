import { OfficeShell } from "@/app/_components/office-shell";
import { requirePageSession } from "@/server/auth/require-page-session";
import { api } from "@/trpc/server";

export default async function ControlPage() {
  await requirePageSession("/control");

  const snapshot = await api.office.getSnapshot();

  return <OfficeShell snapshot={snapshot} />;
}
