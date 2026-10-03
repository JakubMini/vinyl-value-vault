import { Link, NavLink, Route, Routes } from "react-router";

import { Collection } from "./pages/Collection";
import { Insights } from "./pages/Insights";
import { Overview } from "./pages/Overview";
import { Record } from "./pages/Record";
import { Sync } from "./pages/Sync";
import { SyncStatus } from "./SyncStatus";
import "./header.css";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/collection", label: "Collection" },
  { to: "/insights", label: "Insights" },
];

export function App() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <img src="/favicon.svg" alt="" width={22} height={22} />
            Vinyl Value Vault
          </Link>
          <nav aria-label="Main">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
                {item.label}
              </NavLink>
            ))}
          </nav>
          <SyncStatus />
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/collection" element={<Collection />} />
          <Route path="/records/:id" element={<Record />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/sync" element={<Sync />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}

function NotFound() {
  return (
    <section>
      <h1>Not found</h1>
      <p className="muted">
        There is nothing here. <Link to="/">Back to the overview</Link>.
      </p>
    </section>
  );
}
