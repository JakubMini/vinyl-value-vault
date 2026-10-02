/**
 * A small client for the three Discogs endpoints this service uses.
 *
 * - GET /releases/{id}                        the pressing's details, to fill in a record from its id
 * - GET /marketplace/stats/{id}               cheapest copy for sale and how many are listed (no login needed)
 * - GET /marketplace/price_suggestions/{id}   suggested price per condition (needs a token and seller settings)
 *
 * Discogs allows 60 requests a minute with a token, 25 without, and asks for a
 * descriptive User-Agent. The client reads the rate-limit headers so the caller
 * can stop before hitting the ceiling.
 */

export interface DiscogsPrice {
  currency: string;
  value: number;
}

export interface MarketplaceStats {
  lowest_price: DiscogsPrice | null;
  num_for_sale: number;
  blocked_from_sale: boolean;
}

/** Keyed by Discogs condition label, e.g. "Very Good Plus (VG+)". Empty when Discogs has no data. */
export type PriceSuggestions = Record<string, DiscogsPrice>;

export interface Release {
  id: number;
  title: string;
  year?: number;
  country?: string;
  artists?: { name: string; anv?: string; join?: string }[];
  labels?: { name: string; catno?: string }[];
  formats?: { name: string; qty?: string; descriptions?: string[] }[];
}

export class DiscogsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DiscogsError";
  }

  /** True when backing off and trying later is the right response. */
  get isTransient(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export interface DiscogsClientOptions {
  token?: string;
  userAgent: string;
  baseUrl?: string;
}

export class DiscogsClient {
  /** Requests left in the current one-minute window, from the last response. Null until a call is made. */
  rateLimitRemaining: number | null = null;

  constructor(private readonly options: DiscogsClientOptions) {}

  get hasToken(): boolean {
    return Boolean(this.options.token);
  }

  async getRelease(releaseId: number): Promise<Release | null> {
    return this.get<Release>(`/releases/${releaseId}`, undefined, [404]);
  }

  async getMarketplaceStats(releaseId: number, currency: string): Promise<MarketplaceStats | null> {
    return this.get<MarketplaceStats>(`/marketplace/stats/${releaseId}`, { curr_abbr: currency }, [404]);
  }

  /** Null when Discogs will not give suggestions: no token, no seller settings, or unknown release. */
  async getPriceSuggestions(releaseId: number): Promise<PriceSuggestions | null> {
    if (!this.hasToken) return null;
    return this.get<PriceSuggestions>(`/marketplace/price_suggestions/${releaseId}`, undefined, [401, 403, 404]);
  }

  private async get<T>(path: string, query: Record<string, string> | undefined, nullOn: number[]): Promise<T | null> {
    const url = new URL(path, this.options.baseUrl ?? "https://api.discogs.com");
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);

    const headers: Record<string, string> = {
      Accept: "application/vnd.discogs.v2.discogs+json",
      "User-Agent": this.options.userAgent,
    };
    if (this.options.token) headers.Authorization = `Discogs token=${this.options.token}`;

    const response = await fetch(url, { headers });

    const remaining = response.headers.get("X-Discogs-Ratelimit-Remaining");
    if (remaining !== null && remaining !== "") this.rateLimitRemaining = Number(remaining);

    if (nullOn.includes(response.status)) return null;
    if (!response.ok) throw new DiscogsError(response.status, `Discogs ${response.status} for ${url.pathname}`);
    return (await response.json()) as T;
  }
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
        return a.join && a.join !== "" ? `${name} ${a.join} ` : name;
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
