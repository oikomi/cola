import { OfficeBetaShell } from "@/app/_components/office-beta-shell";
import { api } from "@/trpc/server";

export default async function Home() {
  const snapshot = await api.office.getSnapshot();

  return <OfficeBetaShell snapshot={snapshot} />;
}
