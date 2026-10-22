// The tower lobby lives on the dashboard, next to the chat — a separate page
// only fragmented the flow. Keep the URL working as a redirect so old links and
// bookmarks land on the dashboard box instead of a bare page.
import { redirect } from "next/navigation";

export default function TowerLobbyPage() {
  redirect("/");
}
