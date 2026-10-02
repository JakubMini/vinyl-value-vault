-- The media grade each price was for, so a record's price history can show where a regrade
-- moved it.
ALTER TABLE valuations ADD COLUMN media_condition TEXT;

-- Earlier prices: until regrading existed, a grade could only change without re-pricing, and
-- no record had been regraded when this ran, so a record's current grade is the grade its
-- earlier prices were for. It is the best record there is.
UPDATE valuations SET media_condition = (SELECT media_condition FROM records WHERE records.id = valuations.record_id);
