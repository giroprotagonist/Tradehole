type Props = {
  marketFetchedAt: string | null;
  marketLoading: boolean;
  etradeAuthorized: boolean | null;
  ironsightUp: boolean | null;
};

export function StatusBar({
  marketFetchedAt,
  marketLoading,
  etradeAuthorized,
  ironsightUp,
}: Props) {
  return (
    <footer className="status-bar">
      <span>
        Market{" "}
        {marketLoading
          ? "refreshing…"
          : marketFetchedAt
            ? `updated ${new Date(marketFetchedAt).toLocaleTimeString()}`
            : "idle"}
      </span>
      <span>
        E*TRADE{" "}
        {etradeAuthorized == null ? "—" : etradeAuthorized ? "auth OK" : "logged out"}
      </span>
      <span>
        IRONSIGHT{" "}
        {ironsightUp == null ? "—" : ironsightUp ? "up" : "down"}
      </span>
      <span className="muted">Yahoo-delayed quotes · not exchange real-time</span>
    </footer>
  );
}
