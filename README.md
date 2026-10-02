# Vinyl Value Vault

A small backend that keeps a record of every vinyl in the collection, looks up what each one is worth on the market, and keeps a running total of what the whole collection is worth.

## The idea

- **Datastore.** One row per record: artist, title, pressing (label, catalogue number, year, country), condition of media and sleeve, what was paid, and an external id (Discogs release id) so values can be looked up without guesswork.
- **Valuation job.** A cron or microservice that walks the collection, fetches the current market value for each pressing, stores it with a timestamp, and recomputes the collection total. Values are kept as history, so the collection's worth can be charted over time.
- **Collection total.** Always available without recomputing: the latest value per record summed, with the date it was last refreshed.

## Later

- A dashboard to add and edit records, and to see the total and each record's value over time.
- An API so other things can ask about the collection, such as an Alexa skill ("what's my collection worth?", "do I own X?").

## Status

Backend first. Nothing deployed yet.
