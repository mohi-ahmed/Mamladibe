import { createFileRoute } from "@tanstack/react-router";
import { AdminConsole } from "@/components/admin/AdminConsole";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Mamladibe Admin Control Center" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "description", content: "Private Mamladibe moderation and governance console." },
    ],
  }),
  component: AdminConsole,
});
