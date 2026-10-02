import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { type CollectionItem, collectionFieldIds, collectionItemToRecord, isVinyl } from "../src/release";
import { api, resetDatabase } from "./helpers";
import { network } from "./network";

const FIELDS = { media: 1, sleeve: 2, notes: 3 };

function item(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id: 2028684,
    instance_id: 2189974563,
    date_added: "2026-10-02T03:26:16-07:00",
    basic_information: {
      id: 2028684,
      title: "Peer Gynt (Incidental Music)",
      year: 1983,
      artists: [
        { name: "Edvard Grieg", join: "," },
        { name: "Academy Of St. Martin-in-the-Fields", join: "&" },
        { name: "Neville Marriner (2)", join: "" },
      ],
      labels: [{ name: "His Master's Voice", catno: "ASD 143440 1" }],
      formats: [{ name: "Vinyl", qty: "1", descriptions: ["LP", "Stereo"] }],
    },
    ...overrides,
  };
}

describe("mapping a Discogs collection item", () => {
  it("fills the record from the release and remembers the collection item", () => {
    expect(collectionItemToRecord(item(), FIELDS)).toEqual({
      discogs_release_id: 2028684,
      discogs_instance_id: 2189974563,
      artist: "Edvard Grieg, Academy Of St. Martin-in-the-Fields & Neville Marriner",
      title: "Peer Gynt (Incidental Music)",
      label: "His Master's Voice",
      catalogue_number: "ASD 143440 1",
      year: 1983,
      format: "LP, Stereo",
      discogs_added_at: "2026-10-02T10:26:16.000Z",
    });
  });

  it("keeps Discogs' genres and styles as JSON text, and nothing when there are none", () => {
    const described = item({ basic_information: { ...item().basic_information, genres: ["Classical", "Stage & Screen"], styles: ["Romantic"] } });
    expect(collectionItemToRecord(described, FIELDS)).toMatchObject({ genres: '["Classical","Stage & Screen"]', styles: '["Romantic"]' });
    const bare = collectionItemToRecord(item({ basic_information: { ...item().basic_information, genres: [], styles: [] } }), FIELDS);
    expect(bare).not.toHaveProperty("genres");
    expect(bare).not.toHaveProperty("styles");
  });

  it("drops the number Discogs adds to tell same-named labels and artists apart", () => {
    const numbered = item({ basic_information: { ...item().basic_information, labels: [{ name: "Joker (2)", catno: "SM 3719" }] } });
    expect(collectionItemToRecord(numbered, FIELDS)).toMatchObject({
      label: "Joker",
      catalogue_number: "SM 3719",
      artist: "Edvard Grieg, Academy Of St. Martin-in-the-Fields & Neville Marriner",
    });
    // Only a trailing number in brackets goes; anything else in brackets is part of the name.
    const bracketed = item({ basic_information: { ...item().basic_information, labels: [{ name: "Polskie Nagrania Muza (Reissue Series)" }] } });
    expect(collectionItemToRecord(bracketed, FIELDS).label).toBe("Polskie Nagrania Muza (Reissue Series)");
  });

  it("takes the grades from the collection's condition fields", () => {
    const record = collectionItemToRecord(
      item({ notes: [{ field_id: 1, value: "Near Mint (NM or M-)" }, { field_id: 2, value: "Very Good (VG)" }, { field_id: 3, value: "Signed" }] }),
      FIELDS,
    );
    expect(record).toMatchObject({ media_condition: "NM", sleeve_condition: "VG", notes: "Signed" });
  });

  it("keeps an ungradeable sleeve in the notes and leaves the grade to the default", () => {
    const record = collectionItemToRecord(item({ notes: [{ field_id: 2, value: "Generic" }] }), FIELDS);
    expect(record.sleeve_condition).toBeUndefined();
    expect(record.notes).toBe("Sleeve: Generic");
  });

  it("finds the condition and notes fields by name, whatever their case", () => {
    expect(collectionFieldIds([{ id: 7, name: "Notes" }, { id: 5, name: "Media Condition" }, { id: 6, name: "sleeve condition" }])).toEqual({
      media: 5,
      sleeve: 6,
      notes: 7,
    });
    expect(collectionFieldIds([])).toEqual({ media: undefined, sleeve: undefined, notes: undefined });
  });

  it("counts a box set as vinyl only when it contains vinyl", () => {
    const box = (formats: { name: string }[]) => item({ basic_information: { ...item().basic_information, formats } });
    expect(isVinyl(box([{ name: "Box Set" }, { name: "Vinyl" }]))).toBe(true);
    expect(isVinyl(box([{ name: "CD" }]))).toBe(false);
  });
});

describe("adding a collection item through the API", () => {
  beforeEach(resetDatabase);

  it("creates a record without calling Discogs when asked to value it later", async () => {
    let calls = 0;
    network.use(
      http.all("*", () => {
        calls++;
        return HttpResponse.error();
      }),
    );

    const res = await api("/records?value=false", { method: "POST", json: collectionItemToRecord(item(), FIELDS) });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ discogs_instance_id: 2189974563, last_valued_at: null, current_value: null });
    expect(calls).toBe(0);
  });

  it("refuses the same collection item twice", async () => {
    const body = collectionItemToRecord(item(), FIELDS);
    expect((await api("/records?value=false", { method: "POST", json: body })).status).toBe(201);
    const again = await api("/records?value=false", { method: "POST", json: body });
    expect(again.status).toBe(409);
    const { n } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM records").first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it("still allows two copies of the same release from different collection items", async () => {
    const first = collectionItemToRecord(item(), FIELDS);
    const second = { ...first, discogs_instance_id: first.discogs_instance_id + 1 };
    expect((await api("/records?value=false", { method: "POST", json: first })).status).toBe(201);
    expect((await api("/records?value=false", { method: "POST", json: second })).status).toBe(201);
  });
});
