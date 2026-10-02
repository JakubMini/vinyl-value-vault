/** Goldmine grading, the scale Discogs and most collectors use. Best to worst. */
export const GRADES = ["M", "NM", "VG+", "VG", "G+", "G", "F", "P"] as const;
export type Grade = (typeof GRADES)[number];

/** The keys Discogs uses in its price-suggestion payload. */
export const DISCOGS_CONDITION_LABEL: Record<Grade, string> = {
  M: "Mint (M)",
  NM: "Near Mint (NM or M-)",
  "VG+": "Very Good Plus (VG+)",
  VG: "Very Good (VG)",
  "G+": "Good Plus (G+)",
  G: "Good (G)",
  F: "Fair (F)",
  P: "Poor (P)",
};
