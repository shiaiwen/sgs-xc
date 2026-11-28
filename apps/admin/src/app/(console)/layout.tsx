import { AdminShell } from "@/components/admin-shell";
import { AuthGuard } from "@/lib/auth-guard";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AdminShell>{children}</AdminShell>
    </AuthGuard>
  );
}