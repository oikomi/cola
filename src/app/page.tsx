import { OfficeShell } from "@/app/_components/office-shell";
import { api } from "@/trpc/server";

export default async function Home() {
  const snapshot = await api.office.getSnapshot();

  return <OfficeShell snapshot={snapshot} />;
}
