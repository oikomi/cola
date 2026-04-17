import { OfficeShell } from "@/app/_components/office-shell";
import { api } from "@/trpc/server";

export default async function ControlPage() {
  const snapshot = await api.office.getSnapshot();

  return <OfficeShell snapshot={snapshot} />;
}
