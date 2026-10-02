/**
 * The collection as a wall of covers: the same rows the table shows, in the same order, each a
 * link to its record with the value in the corner. For looking at, where the table is for
 * working with.
 */
import { Link } from "react-router";

import type { ListedRecord } from "../src/api-types";
import { formatMinor } from "./format";

export function CoverGrid({ rows }: { rows: ListedRecord[] }) {
  return (
    <ul className="covers" aria-label="Covers">
      {rows.map((r) => {
        const image = r.cover_image_url ?? r.thumb_url;
        return (
          <li key={r.id} className={r.discogs_removed_at ? "cover-tile gone" : "cover-tile"}>
            <Link to={`/records/${r.id}`} className="cover-link">
              <span className="cover-art">
                {image ? <img src={image} alt="" loading="lazy" /> : <span className="cover-empty-art" aria-hidden="true" />}
                {r.current_value_minor !== null && r.current_currency ? (
                  <span className="cover-value">{formatMinor(r.current_value_minor, r.current_currency)}</span>
                ) : null}
              </span>
              <span className="cover-title">{r.title}</span>
              <span className="cover-artist">{r.artist}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
