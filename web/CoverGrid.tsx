/**
 * The collection as a wall of covers: the same rows the table shows, in the same order, each a
 * link to its record with the value in the corner. For looking at, where the table is for
 * working with. Hovering a sleeve slides its record out.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";

import type { ListedRecord } from "../src/api-types";
import { formatMinor, plural } from "./format";

/** A vinyl disc, drawn in CSS. Decorative: it sits behind a sleeve and slides out on hover. */
export function Disc() {
  return <span className="disc" aria-hidden="true" />;
}

const value = (r: ListedRecord): ReactNode =>
  r.current_value_minor !== null && r.current_currency ? formatMinor(r.current_value_minor, r.current_currency) : null;

/** `corner` says what sits on the sleeve's corner: the value unless the page wants something else. */
export function CoverGrid({ rows, corner = value }: { rows: ListedRecord[]; corner?: (r: ListedRecord) => ReactNode }) {
  return (
    <ul className="covers" aria-label="Covers">
      {rows.map((r) => {
        const image = r.cover_image_url ?? r.thumb_url;
        const badge = corner(r);
        return (
          <li key={r.id} className={r.discogs_removed_at ? "cover-tile gone" : "cover-tile"}>
            <Link to={`/records/${r.id}`} className="cover-link">
              <span className="sleeve">
                <Disc />
                <span className="cover-art">
                  {image ? <img src={image} alt="" loading="lazy" /> : <span className="cover-empty-art" aria-hidden="true" />}
                  {badge !== null ? <span className="cover-value">{badge}</span> : null}
                </span>
              </span>
              <span className="cover-title">{r.title}</span>
              <span className="cover-artist">
                {r.artist}
                {r.play_count > 0 ? <span className="cover-plays"> · {plural(r.play_count, "play")}</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
