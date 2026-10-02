import type { ListedRecord } from "../src/api-types";
import { totals } from "../src/select";
import { MoneyChange } from "./components";
import { count, formatMinor, plural } from "./format";

/** What the rows on screen add up to, so a filter answers "what is this part of the collection worth?" */
export function Totals({ shown, all, currency, over }: { shown: ListedRecord[]; all: number; currency: string; over: string }) {
  const t = totals(shown, currency);
  return (
    <p className="totals muted" aria-live="polite">
      <span>
        {count(t.count)} of {count(all)} records
      </span>
      {t.priced > 0 ? (
        <span>
          worth <strong>{formatMinor(t.value_minor, currency)}</strong>
          {t.priced < t.count ? ` across the ${count(t.priced)} priced` : ""}
        </span>
      ) : null}
      {t.change_minor !== null ? (
        <span>
          <MoneyChange minor={t.change_minor} currency={currency} /> {over}
        </span>
      ) : null}
      {t.gain_minor !== null ? (
        <span>
          <MoneyChange minor={t.gain_minor} currency={currency} /> on {plural(t.paid, "record")} with a price paid
        </span>
      ) : null}
    </p>
  );
}
