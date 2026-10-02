import { type FormEvent, useState } from "react";

import type { RecordDetail } from "../src/api-types";
import { spotifyAlbumId, spotifyAlbumUrl, spotifyEmbedUrl, spotifySearchUrl } from "../src/spotify";
import { ErrorState } from "./components";
import { useUpdateRecord } from "./queries";

/**
 * Spotify for one record: the embedded player once an album is pinned, otherwise a search link
 * and a box to paste the album's link into.
 */
export function Listen({ record: r }: { record: RecordDetail }) {
  const update = useUpdateRecord();
  const [link, setLink] = useState("");
  const [editing, setEditing] = useState(false);
  const id = link.trim() ? spotifyAlbumId(link) : null;

  function pin(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    update.mutate(
      { id: r.id, patch: { spotify_album_id: id } },
      {
        onSuccess: () => {
          setLink("");
          setEditing(false);
        },
      },
    );
  }

  const pinned = r.spotify_album_id;
  return (
    <div className="card">
      <div className="row-between">
        <h2 className="card-title">Listen</h2>
        {pinned && !editing ? (
          <div className="actions">
            <a className="button" href={spotifyAlbumUrl(pinned)} target="_blank" rel="noreferrer">
              Open in Spotify ↗
            </a>
            <button type="button" className="button" onClick={() => setEditing(true)}>
              Change
            </button>
          </div>
        ) : null}
      </div>

      {pinned && !editing ? (
        <iframe
          className="spotify-embed"
          title={`Spotify player for ${r.title}`}
          src={spotifyEmbedUrl(pinned)}
          height={352}
          loading="lazy"
          allow="encrypted-media; clipboard-write; fullscreen; picture-in-picture"
        />
      ) : (
        <form className="form" onSubmit={pin}>
          <p className="muted">
            <a href={spotifySearchUrl(r.artist, r.title)} target="_blank" rel="noreferrer">
              Find “{r.title}” on Spotify ↗
            </a>
            , then copy the album's link (Share → Copy album link) and paste it here to pin it.
          </p>
          <div className="actions">
            <input
              className="input grow"
              placeholder="https://open.spotify.com/album/…"
              aria-label="Spotify album link"
              aria-invalid={link.trim() !== "" && id === null}
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <button type="submit" className="button button-primary" disabled={!id || update.isPending}>
              {update.isPending ? "Pinning…" : "Pin album"}
            </button>
            {pinned ? (
              <>
                <button type="button" className="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button button-danger"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: r.id, patch: { spotify_album_id: null } }, { onSuccess: () => setEditing(false) })}
                >
                  Unpin
                </button>
              </>
            ) : null}
          </div>
          {link.trim() !== "" && id === null ? <p className="note">That doesn't look like a Spotify album link.</p> : null}
          {update.isError ? <ErrorState error={update.error} /> : null}
        </form>
      )}
    </div>
  );
}
