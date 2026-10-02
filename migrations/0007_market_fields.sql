-- How the current value was found, and the market behind it, rolled up onto the record from
-- its latest valuation the way current_value_minor already is. The collection list is read
-- once a minute while records are queued, so these must not cost a join per record.
ALTER TABLE records ADD COLUMN current_method TEXT;                   -- 'price_suggestion' or 'lowest_listing'
ALTER TABLE records ADD COLUMN current_lowest_listing_minor INTEGER;  -- cheapest copy for sale at the time, any grade
ALTER TABLE records ADD COLUMN current_num_for_sale INTEGER;

-- Backfill from each record's newest valuation. A regrade row counts: a regrade is a price
-- suggestion, and it carries the listing figures of the Discogs price it was worked out from.
UPDATE records
SET current_method = v.method,
    current_lowest_listing_minor = v.lowest_listing_minor,
    current_num_for_sale = v.num_for_sale
FROM valuations v
WHERE v.record_id = records.id
  AND v.id IN (SELECT MAX(id) FROM valuations GROUP BY record_id);
