/**
 * Discogs release and collection data, and how it maps onto a record. Its only import is
 * grades.ts, named with its .ts extension, so Node can load this file directly for
 * scripts/import-discogs.ts as well as bundling it into the Worker.
 */

import { DISCOGS_CONDITION_LABEL, type Grade } from "./grades.ts";

/** The release shape shared by GET /releases/{id} and a collection item's basic_information. */
export interface Release {
  id: number;
  title: string;
  year?: number;
  country?: string;
  artists?: { name: string; anv?: string; join?: string }[];
  labels?: { name: string; catno?: string }[];
  formats?: { name: string; qty?: string; descriptions?: string[] }[];
}

/** Turn a Discogs release into the fields a record needs, so adding by id is enough. */
export function releaseToRecordFields(release: Release): {
  artist: string;
  title: string;
  label?: string;
  catalogue_number?: string;
  year?: number;
  country?: string;
  format?: string;
} {
  const artist =
    (release.artists ?? [])
      .map((a) => {
        // Discogs disambiguates duplicate names with a suffix like "Nirvana (2)".
        const name = (a.anv || a.name).replace(/\s\(\d+\)$/, "");
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
    ...(label?.name ? { label: label.name } : {}),
    ...(label?.catno && label.catno !== "none" ? { catalogue_number: label.catno } : {}),
    ...(release.year ? { year: release.year } : {}),
    ...(release.country ? { country: release.country } : {}),
    ...(formatText ? { format: formatText } : {}),
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
  media_condition?: Grade;
  sleeve_condition?: Grade;
  notes?: string;
}

const GRADE_BY_DISCOGS_LABEL = new Map<string, Grade>(
  Object.entries(DISCOGS_CONDITION_LABEL).map(([grade, label]) => [label, grade as Grade]),
);

/** True when the item is a record. A box set counts when Discogs lists vinyl among its formats. */
export function isVinyl(item: CollectionItem): boolean {
  return (item.basic_information.formats ?? []).some((f) => f.name === "Vinyl");
}

/**
 * Map a collection item to the body for POST /records. Grades come from the collection's
 * condition fields when set; otherwise the vault's default (VG+) applies. A sleeve that is
 * "Generic" or "No Cover" has no grade, so it is recorded in the notes instead.
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

  return {
    ...releaseToRecordFields(item.basic_information),
    discogs_release_id: item.id,
    discogs_instance_id: item.instance_id,
    ...(mediaGrade ? { media_condition: mediaGrade } : {}),
    ...(sleeveGrade ? { sleeve_condition: sleeveGrade } : {}),
    ...(extraNotes ? { notes: extraNotes } : {}),
  };
}
