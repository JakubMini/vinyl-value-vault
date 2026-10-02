/**
 * The collection as a spreadsheet. Pure: no DOM, no Worker. The dashboard turns the text into a
 * download; a script could write it to a file.
 */
import type { ListedRecord } from "./api-types";
import { spotifyAlbumUrl } from "./spotify";

type Cell = string | number | null | undefined;

/**
 * One CSV cell. Quoted when it holds a comma, a quote or a line break. A text cell that starts
 * with = + - @ or a tab is prefixed with an apostrophe, so a spreadsheet shows it rather than
 * running it as a formula; numbers are left as numbers.
 */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Rows as CSV text, lines ending in CRLF as the RFC has it. */
export function toCsv(rows: readonly (readonly Cell[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const major = (minor: number | null) => (minor === null ? null : minor / 100);

/** What each column of a collection export holds. Money is in major units (pounds), dates as ISO text. */
export const RECORD_CSV_COLUMNS: readonly { header: string; value: (r: ListedRecord) => Cell }[] = [
  { header: "Artist", value: (r) => r.artist },
  { header: "Title", value: (r) => r.title },
  { header: "Label", value: (r) => r.label },
  { header: "Catalogue number", value: (r) => r.catalogue_number },
  { header: "Year", value: (r) => r.year },
  { header: "Format", value: (r) => r.format },
  { header: "Genres", value: (r) => r.genres.join("; ") },
  { header: "Styles", value: (r) => r.styles.join("; ") },
  { header: "Media", value: (r) => r.media_condition },
  { header: "Sleeve", value: (r) => r.sleeve_condition },
  { header: "Value", value: (r) => major(r.current_value_minor) },
  { header: "Currency", value: (r) => r.current_currency },
  { header: "Change over window", value: (r) => major(r.change_minor) },
  { header: "Change over 30 days", value: (r) => major(r.change_30d_minor) },
  { header: "Gain on price paid", value: (r) => major(r.gain_minor) },
  { header: "Price paid", value: (r) => major(r.purchase_price_minor) },
  { header: "Paid in", value: (r) => r.purchase_currency },
  { header: "Bought on", value: (r) => r.purchased_on },
  { header: "Priced from", value: (r) => (r.current_method === "price_suggestion" ? "suggestion" : r.current_method === "lowest_listing" ? "cheapest listing" : null) },
  { header: "Copies for sale", value: (r) => r.current_num_for_sale },
  { header: "Cheapest copy", value: (r) => major(r.current_lowest_listing_minor) },
  { header: "Last priced", value: (r) => r.last_valued_at },
  { header: "Added to Discogs", value: (r) => r.discogs_added_at },
  { header: "Gone from Discogs", value: (r) => r.discogs_removed_at },
  { header: "Discogs", value: (r) => (r.discogs_release_id === null ? null : `https://www.discogs.com/release/${r.discogs_release_id}`) },
  { header: "Spotify", value: (r) => (r.spotify_album_id === null ? null : spotifyAlbumUrl(r.spotify_album_id)) },
  { header: "Notes", value: (r) => r.notes },
];

/** The records as CSV, in the order given, with a header row. */
export function recordsCsv(records: readonly ListedRecord[]): string {
  return toCsv([RECORD_CSV_COLUMNS.map((c) => c.header), ...records.map((r) => RECORD_CSV_COLUMNS.map((c) => c.value(r)))]);
}
