type Props = {
  up: boolean | null;
  url: string;
  /** Full-page tab vs old cramped side panel */
  mode?: "page" | "panel";
};

export function Geopolitical({ up, url, mode = "page" }: Props) {
  const isPage = mode === "page";

  return (
    <section className={isPage ? "ironsight-page" : "panel geo-panel"}>
      <div className={isPage ? "ironsight-page-head" : "panel-head"}>
        <div>
          <p className="eyebrow">OSINT</p>
          <h2>IRONSIGHT</h2>
          {!isPage && (
            <p className="muted">Middle East / Red Sea / energy theater</p>
          )}
          {isPage && (
            <p className="muted">
              Full theater view · Middle East / Red Sea / energy · {url}
            </p>
          )}
        </div>
        <span className={`pill ${up ? "live" : ""}`}>
          {up == null ? "checking…" : up ? "online" : "offline"}
        </span>
      </div>

      {up ? (
        <iframe title="IRONSIGHT" src={url} className={isPage ? "ironsight-frame-full" : "ironsight-frame"} />
      ) : (
        <div className={`empty-osint ${isPage ? "empty-osint-full" : ""}`}>
          <p>
            IRONSIGHT is not running at <code>{url}</code>.
          </p>
          <ol>
            <li>
              <code>git clone https://github.com/NoblerWorks-HQ/IRONSIGHT.git ../IRONSIGHT</code>
            </li>
            <li>
              <code>cd ../IRONSIGHT && npm install</code>
            </li>
            <li>
              From this repo: <code>npm run osint</code>
            </li>
          </ol>
        </div>
      )}
    </section>
  );
}
