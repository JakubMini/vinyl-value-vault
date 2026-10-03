import { type FormEvent, useState } from "react";

import type { RecordDetail } from "../src/api-types";
import { spotifyAlbumId, spotifyEmbedUrl, spotifySearchUrl } from "../src/spotify";
import { ErrorState } from "./components";
import { useUpdateRecord } from "./queries";
import { useReturnFocus } from "./RecordMenu";
import "./record.css";

/** Spotify's compact player: the album and a play button, without the tracklist. */
const EMBED_HEIGHT = 152;

/**
 * Spotify for one record: a compact player once an album is pinned, otherwise one line that
 * opens a box to paste the album's link into.
 */
export function Listen({ record: r }: { record: RecordDetail }) {
  const update = useUpdateRecord();
  const [link, setLink] = useState("");
  const [editing, setEditing] = useState(false);
  const opener = useReturnFocus<HTMLButtonElement>(editing);
  const id = link.trim() ? spotifyAlbumId(link) : null;
  const pinned = r.spotify_album_id;

  function close() {
    setLink("");
    setEditing(false);
  }

  function pin(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    update.mutate({ id: r.id, patch: { spotify_album_id: id } }, { onSuccess: close });
  }

  if (editing) {
    return (
      <form className="rec-row rec-row-open form" onSubmit={pin}>
        <h2 className="rec-row-label">Listen</h2>
        <div className="rec-row-body">
          <p className="rec-note">
            <a href={spotifySearchUrl(r.artist, r.title)} target="_blank" rel="noreferrer">
              Find “{r.title}” on Spotify ↗
            </a>
          </p>
          <div className="actions">
            {/* Opened to paste into, so it takes the focus. */}
            <input
              className="input grow"
              placeholder="https://open.spotify.com/album/…"
              title="On Spotify: Share → Copy album link"
              aria-label="Spotify album link"
              aria-invalid={link.trim() !== "" && id === null}
              autoFocus
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <button type="submit" className="button button-primary" disabled={!id || update.isPending}>
              {update.isPending ? "Pinning…" : "Pin album"}
            </button>
            <button type="button" className="button" disabled={update.isPending} onClick={close}>
              Cancel
            </button>
            {pinned ? (
              <button
                type="button"
                className="button button-danger"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: r.id, patch: { spotify_album_id: null } }, { onSuccess: close })}
              >
                Unpin
              </button>
            ) : null}
          </div>
          {link.trim() !== "" && id === null ? <p className="note">That doesn't look like a Spotify album link.</p> : null}
          {update.isError ? <ErrorState error={update.error} /> : null}
        </div>
      </form>
    );
  }

  if (!pinned) {
    return (
      <div className="rec-row">
        <h2 className="rec-row-label">Listen</h2>
        <div className="rec-row-body">
          <button ref={opener} type="button" className="rec-text-button" onClick={() => setEditing(true)}>
            Add a Spotify link
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rec-row rec-row-media">
      <h2 className="rec-row-label">Listen</h2>
      <iframe
        className="spotify-embed rec-row-body"
        title={`Spotify player for ${r.title}`}
        src={spotifyEmbedUrl(pinned)}
        height={EMBED_HEIGHT}
        loading="lazy"
        allow="encrypted-media; clipboard-write; fullscreen; picture-in-picture"
      />
      <button ref={opener} type="button" className="rec-text-button rec-row-action" aria-label="Change the Spotify album" onClick={() => setEditing(true)}>
        Change
      </button>
    </div>
  );
}
