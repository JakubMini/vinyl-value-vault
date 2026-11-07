import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";

import type { FirmwareInfo, LinkedDevice } from "../../src/api-types";
import { ErrorState, Loading, When } from "../components";
import { useApproveDevice, useDevices, useFirmware, useRevokeDevice, useUploadFirmware } from "../queries";

/** Where a screen sends me to approve the code it shows: /link, or /link?code=XXXX-XXXX with the code filled in. */
export function LinkScreen() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const approve = useApproveDevice();
  const devices = useDevices();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (code.trim()) approve.mutate(code.trim());
  }

  return (
    <section className="stack">
      <div>
        <h1>Link a screen</h1>
        <p className="muted measure">Type in the code the screen shows. A linked screen can read records and change their grades, nothing more.</p>
      </div>

      <form className="actions" onSubmit={submit}>
        <input
          className="input"
          aria-label="Code from the screen"
          placeholder="XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            approve.reset();
          }}
        />
        <button type="submit" className="button button-primary" disabled={!code.trim() || approve.isPending}>
          {approve.isPending ? "Approving…" : "Approve"}
        </button>
      </form>
      {approve.isError ? <ErrorState error={approve.error} /> : null}
      {approve.isSuccess ? (
        <p className="note" aria-live="polite">
          Approved. The screen links itself within a few seconds.
        </p>
      ) : null}

      <div>
        <h2>Linked screens</h2>
        {devices.isPending ? <Loading /> : devices.isError ? <ErrorState error={devices.error} /> : <Devices devices={devices.data} />}
      </div>

      <Firmware />
    </section>
  );
}

function Devices({ devices }: { devices: LinkedDevice[] }) {
  const revoke = useRevokeDevice();
  if (devices.length === 0) return <p className="muted">No screens linked.</p>;
  return (
    <>
      {revoke.isError ? <ErrorState error={revoke.error} /> : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Screen</th>
              <th scope="col">Linked</th>
              <th scope="col">
                <span className="sr-only">Revoke</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>Screen {d.id}</td>
                <td>{d.approved_at ? <When iso={d.approved_at} /> : "—"}</td>
                <td className="num">
                  <button type="button" className="button button-danger" disabled={revoke.isPending} onClick={() => revoke.mutate(d.id)}>
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** The build the screens install: each screen checks on its next sync and restarts into it. */
function Firmware() {
  const firmware = useFirmware();
  const upload = useUploadFirmware();
  const [file, setFile] = useState<File | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (file) upload.mutate(file);
  }

  return (
    <div className="stack">
      <div>
        <h2>Firmware</h2>
        <p className="muted measure">
          Upload the screen&apos;s <code>firmware.bin</code>. Each screen installs it on its next sync (within the hour, or
          straight away on Refresh) and restarts. If the new build can&apos;t reach the vault, the screen goes back to the old one.
        </p>
      </div>
      {firmware.isPending ? <Loading /> : firmware.isError ? <ErrorState error={firmware.error} /> : <Current info={firmware.data} />}
      <form className="actions" onSubmit={submit}>
        <input
          className="input"
          type="file"
          accept=".bin,application/octet-stream"
          aria-label="Firmware file"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            upload.reset();
          }}
        />
        <button type="submit" className="button button-primary" disabled={!file || upload.isPending}>
          {upload.isPending ? "Uploading…" : "Upload"}
        </button>
      </form>
      {upload.isError ? <ErrorState error={upload.error} /> : null}
      {upload.isSuccess ? (
        <p className="note" aria-live="polite">
          Uploaded. Screens pick it up on their next sync.
        </p>
      ) : null}
    </div>
  );
}

function Current({ info }: { info: FirmwareInfo | null }) {
  if (!info) return <p className="muted">Nothing uploaded yet.</p>;
  return (
    <p>
      Build <code>{info.build.slice(0, 8)}</code>, {(info.size / 1048576).toFixed(1)} MB, uploaded <When iso={info.uploaded_at} />.
    </p>
  );
}
