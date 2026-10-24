import { redirect } from "next/navigation";
import { getAdminSession, hasPermission } from "@/lib/auth";

export default async function WhatsAppNotificationsLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (!hasPermission(session, "settings:write")) redirect("/admin");
  return children;
}
