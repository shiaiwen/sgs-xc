import { ChangelogView } from "@/components/changelog-view";
import { getReleases } from "@/lib/releases";

export const dynamic = "force-static";

export default function Page() {
  return <ChangelogView releases={getReleases()} />;
}
