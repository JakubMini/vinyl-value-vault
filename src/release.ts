/** Discogs release and collection data, and how it maps onto a record. */

import { DISCOGS_CONDITION_LABEL, type Grade } from "./grades";

/** The release shape shared by GET /releases/{id} and a collection item's basic_information. */
export interface Release {
  id: number;
  title: string;
  year?: number;
  country?: string;
  artists?: { name: string; anv?: string; join?: string }[];
  labels?: { name: string; catno?: string }[];
  formats?: { name: string; qty?: string; descriptions?: string[] }[];
  /** Discogs' broad genres ("Rock", "Jazz") and finer styles ("Indie Rock", "Hard Bop"). */
  genres?: string[];
  styles?: string[];
  /** Image URLs, present in collection items. Empty, or a spacer image, when there is no artwork. */
  cover_image?: string;
  thumb?: string;
}

/** Discogs tells same-named artists and labels apart with a number: "Nirvana (2)", "Joker (2)". Collectors never write it. */
function plainName(name: string): string {
  return name.replace(/\s\(\d+\)$/, "");
}

/**
 * Turn a Discogs release into the fields a record needs, so adding by id is enough. Genres and
 * styles are kept as JSON text, the form they take in the database, so a sync can compare them
 * as plain strings and D1 can bind them.
 */
export function releaseToRecordFields(release: Release): {
  artist: string;
  title: string;
  label?: string;
  catalogue_number?: string;
  year?: number;
  country?: string;
  format?: string;
  genres?: string;
  styles?: string;
} {
  const artist =
    (release.artists ?? [])
      .map((a) => {
        const name = plainName(a.anv || a.name);
        if (!a.join) return name;
        // Discogs stores joiners bare: "," "&" "feat." "Vs". A comma hugs the name before it.
        return a.join === "," ? `${name}, ` : `${name} ${a.join} `;
      })
      .join("")
      .trim() || "Unknown artist";

  const label = release.labels?.[0];
  const format = release.formats?.[0];
  const qty = Number(format?.qty ?? "1");
  const formatText = format
    ? [qty > 1 ? `${qty}x` : "", format.name === "Vinyl" ? "" : format.name, ...(format.descriptions ?? [])]
        .filter(Boolean)
        .join(", ")
        .replace(/^(\d+x), /, "$1")
    : undefined;

  return {
    artist,
    title: release.title,
    ...(label?.name ? { label: plainName(label.name) } : {}),
    ...(label?.catno && label.catno !== "none" ? { catalogue_number: label.catno } : {}),
    ...(release.year ? { year: release.year } : {}),
    ...(release.country ? { country: release.country } : {}),
    ...(formatText ? { format: formatText } : {}),
    ...(release.genres?.length ? { genres: JSON.stringify(release.genres) } : {}),
    ...(release.styles?.length ? { styles: JSON.stringify(release.styles) } : {}),
  };
}

/** One item in a Discogs user's collection (GET /users/{name}/collection/folders/0/releases). */
export interface CollectionItem {
  id: number; // the release id
  instance_id: number; // this copy in this collection
  date_added: string;
  basic_information: Release;
  notes?: { field_id: number; value: string }[];
}

/** Which collection field holds what. Discogs creates these by default, but users can rename them. */
export interface CollectionFieldIds {
  media?: number;
  sleeve?: number;
  notes?: number;
}

/** Find the condition and notes fields among a collection's fields (GET /users/{name}/collection/fields). */
export function collectionFieldIds(fields: { id: number; name: string }[]): CollectionFieldIds {
  const id = (name: string) => fields.find((f) => f.name.trim().toLowerCase() === name)?.id;
  return { media: id("media condition"), sleeve: id("sleeve condition"), notes: id("notes") };
}

export interface ImportedRecord {
  discogs_release_id: number;
  discogs_instance_id: number;
  artist: string;
  title: string;
  label?: string;
  catalogue_number?: string;
  year?: number;
  country?: string;
  format?: string;
  /** JSON arrays of strings, as stored. */
  genres?: string;
  styles?: string;
  media_condition?: Grade;
  sleeve_condition?: Grade;
  notes?: string;
  cover_image_url?: string;
  thumb_url?: string;
  discogs_added_at?: string;
}

/** Discogs serves a spacer image, or nothing, when a release has no artwork. */
function imageUrl(url: string | undefined): string | undefined {
  return url && !url.endsWith("/spacer.gif") ? url : undefined;
}

/** Discogs dates carry a local offset ("2026-10-02T03:26:16-07:00"); the vault stores UTC. */
function utc(value: string | undefined): string | undefined {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

const GRADE_BY_DISCOGS_LABEL = new Map<string, Grade>(
  Object.entries(DISCOGS_CONDITION_LABEL).map(([grade, label]) => [label, grade as Grade]),
);

/** True when the item is a record. A box set counts when Discogs lists vinyl among its formats. */
export function isVinyl(item: CollectionItem): boolean {
  return (item.basic_information.formats ?? []).some((f) => f.name === "Vinyl");
}

/**
 * Map a collection item to a record. Grades come from the collection's condition fields when
 * set; otherwise the vault's default (VG+) applies. A sleeve that is "Generic" or "No Cover"
 * has no grade, so it is recorded in the notes instead.
 */
export function collectionItemToRecord(item: CollectionItem, fields: CollectionFieldIds): ImportedRecord {
  const note = (id: number | undefined) =>
    id === undefined ? undefined : item.notes?.find((n) => n.field_id === id)?.value.trim() || undefined;

  const media = note(fields.media);
  const sleeve = note(fields.sleeve);
  const extraNotes = [note(fields.notes), sleeve && !GRADE_BY_DISCOGS_LABEL.has(sleeve) ? `Sleeve: ${sleeve}` : undefined]
    .filter(Boolean)
    .join("\n");

  const mediaGrade = media ? GRADE_BY_DISCOGS_LABEL.get(media) : undefined;
  const sleeveGrade = sleeve ? GRADE_BY_DISCOGS_LABEL.get(sleeve) : undefined;
  const cover = imageUrl(item.basic_information.cover_image);
  const thumb = imageUrl(item.basic_information.thumb);
  const addedAt = utc(item.date_added);

  return {
    ...releaseToRecordFields(item.basic_information),
    discogs_release_id: item.id,
    discogs_instance_id: item.instance_id,
    ...(mediaGrade ? { media_condition: mediaGrade } : {}),
    ...(sleeveGrade ? { sleeve_condition: sleeveGrade } : {}),
    ...(extraNotes ? { notes: extraNotes } : {}),
    ...(cover ? { cover_image_url: cover } : {}),
    ...(thumb ? { thumb_url: thumb } : {}),
    ...(addedAt ? { discogs_added_at: addedAt } : {}),
  };
}
