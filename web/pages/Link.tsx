import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";

import type { LinkedDevice } from "../../src/api-types";
import { ErrorState, Loading, When } from "../components";
import { useApproveDevice, useDevices, useRevokeDevice } from "../queries";

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
