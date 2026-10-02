import { DEFAULT_SELECTION, type Selection, writeSelection } from "../src/select";

/** The collection page narrowed to a selection. */
export function collectionLink(partial: Partial<Selection>): string {
  const query = new URLSearchParams(writeSelection({ ...DEFAULT_SELECTION, ...partial })).toString();
  return query ? `/collection?${query}` : "/collection";
}
