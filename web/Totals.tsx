import type { ListedRecord } from "../src/api-types";
import { totals } from "../src/select";
import { MoneyChange } from "./components";
import { count, formatMinor, plural } from "./format";

/**
 * What the rows on screen add up to, beside the page title: "43 of 163 records · £812.40". The
 * change and the gain on what was paid appear only when there is one.
 */
export function Totals({ shown, all, currency, over }: { shown: ListedRecord[]; all: number; currency: string; over: string }) {
  const t = totals(shown, currency);
  return (
    <p className="totals" aria-live="polite">
      <span>{t.count === all ? plural(all, "record") : `${count(t.count)} of ${plural(all, "record")}`}</span>
      {t.priced > 0 ? (
        <span className="totals-value" title={t.priced < t.count ? `Across the ${count(t.priced)} priced` : undefined}>
          {formatMinor(t.value_minor, currency)}
        </span>
      ) : null}
      {t.change_minor ? (
        <span>
          <MoneyChange minor={t.change_minor} currency={currency} /> {over}
        </span>
      ) : null}
      {t.gain_minor ? (
        <span title={`On ${plural(t.paid, "record")} with a price paid`}>
          <MoneyChange minor={t.gain_minor} currency={currency} /> on cost
        </span>
      ) : null}
    </p>
  );
}
