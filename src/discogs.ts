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
import type { Release } from "./release";

export type { Release } from "./release";

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
