import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";

export default async function RootPage() {
  const session = await auth();
  redirect(session?.user?.orgId ? "/engagements" : "/login");
}
