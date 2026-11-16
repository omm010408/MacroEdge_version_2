import { DEFAULT_WATCHLIST_ITEMS, WATCHLIST_UNIVERSE } from "@/services/macro-data";
import { WatchListView } from "@/components/views/WatchListView";

export default function WatchListPage() {
  return (
    <WatchListView
      defaultItems={DEFAULT_WATCHLIST_ITEMS}
      universe={WATCHLIST_UNIVERSE}
    />
  );
}
