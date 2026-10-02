/**
 * Linking a record to Spotify, without the Spotify API.
 *
 * Since February 2026 Spotify's API needs a Premium account behind every hobby app, so the vault
 * does not call it. Instead a record can be pinned to an album by pasting its link, and anything
 * unpinned gets a search link. Spotify's embedded player needs no API at all.
 *
 * Runtime-free, so both the Worker (to validate) and the dashboard (to build links) use it.
 */

const ALBUM_ID = /^[0-9A-Za-z]{22}$/;

/**
 * The album id from anything Spotify gives you to share an album: a link
 * (https://open.spotify.com/album/<id>?si=…, also with an /intl-xx/ prefix), a URI
 * (spotify:album:<id>), or the bare 22-character id. Null for anything else, including links
 * to tracks, artists or playlists.
 */
export function spotifyAlbumId(input: string): string | null {
  const value = input.trim();
  if (ALBUM_ID.test(value)) return value;

  const uri = /^spotify:album:([0-9A-Za-z]{22})$/.exec(value);
  if (uri) return uri[1]!;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "open.spotify.com") return null;
  const path = /^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?album\/([0-9A-Za-z]{22})\/?$/i.exec(url.pathname);
  return path ? path[1]! : null;
}

export function spotifyAlbumUrl(id: string): string {
  return `https://open.spotify.com/album/${id}`;
}

export function spotifyEmbedUrl(id: string): string {
  return `https://open.spotify.com/embed/album/${id}`;
}

export function spotifySearchUrl(artist: string, title: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`)}`;
}
