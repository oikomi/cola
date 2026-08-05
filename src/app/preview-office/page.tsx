import { OfficeBetaShell } from "@/app/_components/office-beta-shell";
import { officeSnapshot } from "@/server/office/sample-data";

export default function OfficePreviewPage() {
  return <OfficeBetaShell snapshot={officeSnapshot} />;
}
