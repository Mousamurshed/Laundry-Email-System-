-- Remove redundant ", Apt #XY" suffix when the address already contains "#XY"
-- e.g. "1075 1st Ave #1A, Apt #1A" → "1075 1st Ave #1A"
-- Only strips the suffix when a #unit marker already appears earlier in the string.

UPDATE contacts
SET address = TRIM(REGEXP_REPLACE(address, '\s*,\s*Apt\s+#?\w[-\w]*\s*$', '', 'i'))
WHERE address ~ '#\w'
  AND address ~* ',\s*Apt\s+#?\w';
