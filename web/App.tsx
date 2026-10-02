import { Link, NavLink, Route, Routes } from "react-router";

import { Overview } from "./pages/Overview";
import { Sync } from "./pages/Sync";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/sync", label: "Sync" },
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
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Overview />} />
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
