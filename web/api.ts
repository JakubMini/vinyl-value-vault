/**
 * Talking to the vault's API from the browser.
 *
 * In production the browser is signed in through Cloudflare Access, which attaches its token
 * to every request on its own; this code sends no credentials. In development (`vite dev`)
 * there is no Access, so the API key is read from .env.development.local, a file Vite loads
 * only in development and that never reaches a production build.
 */
import type { ApiErrorBody } from "../src/api-types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (import.meta.env.DEV && import.meta.env.VITE_DEV_API_KEY) {
    headers.set("Authorization", `Bearer ${import.meta.env.VITE_DEV_API_KEY}`);
  }
  let body = rest.body;
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }

  // An expired Access session answers with a redirect to the login page on another origin,
  // which fetch cannot follow. Reloading the page lets Access sign the browser in again.
  const response = await fetch(`/api${path}`, { ...rest, headers, body, redirect: "manual" });
  if (response.type === "opaqueredirect") {
    window.location.reload();
    throw new ApiError(401, "Signing in again");
  }

  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message = (payload as ApiErrorBody | null)?.error ?? `${response.status} ${response.statusText}`;
    throw new ApiError(response.status, message, payload);
  }
  return payload as T;
}
