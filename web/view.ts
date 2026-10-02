/** Table or covers. `?view=grid` in the URL wins; otherwise the last choice made in this browser. */

export type View = "table" | "grid";

const STORAGE_KEY = "vinyl-value-vault.view";

export function loadView(): View {
  try {
    return localStorage.getItem(STORAGE_KEY) === "grid" ? "grid" : "table";
  } catch {
    return "table";
  }
}

export function saveView(view: View): void {
  try {
    localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // The choice lasts the visit.
  }
}

export function readView(params: { get(name: string): string | null }): View {
  const asked = params.get("view");
  return asked === "grid" ? "grid" : asked === "table" ? "table" : loadView();
}
