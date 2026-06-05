-- Backfill batch names for contacts imported before the batch system existed.
-- Groups contacts by (user_id, DATE(created_at)) in chronological order and
-- assigns "Batch 1", "Batch 2", etc., skipping any numbers already in use.
-- Idempotent: only touches contacts where import_date IS NULL.

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN (
    WITH untagged_groups AS (
      SELECT
        user_id,
        DATE(created_at) AS import_day,
        COUNT(*)::int    AS cnt
      FROM contacts
      WHERE import_date IS NULL
      GROUP BY user_id, DATE(created_at)
    ),
    existing_max AS (
      SELECT
        user_id,
        COALESCE(MAX(
          CASE WHEN name ~ '^Batch [0-9]+$'
               THEN (regexp_match(name, '^Batch ([0-9]+)$'))[1]::int
               ELSE 0 END
        ), 0) AS hi
      FROM batches
      GROUP BY user_id
    ),
    ranked AS (
      SELECT
        g.user_id,
        g.import_day,
        g.cnt,
        'Batch ' || (
          ROW_NUMBER() OVER (PARTITION BY g.user_id ORDER BY g.import_day ASC)
          + COALESCE(em.hi, 0)
        )::text AS batch_name
      FROM untagged_groups g
      LEFT JOIN existing_max em ON em.user_id = g.user_id
    )
    SELECT * FROM ranked ORDER BY user_id, import_day
  )
  LOOP
    -- Tag contacts and set import_date
    UPDATE contacts
    SET
      tags        = CASE
                      WHEN tags IS NULL OR tags = '{}'
                      THEN ARRAY[rec.batch_name]
                      ELSE ARRAY[rec.batch_name] || tags
                    END,
      import_date = rec.import_day
    WHERE user_id    = rec.user_id
      AND DATE(created_at) = rec.import_day
      AND import_date IS NULL;

    -- Record the batch (skip if already inserted by a previous run)
    INSERT INTO batches (user_id, name, import_date, contact_count)
    SELECT rec.user_id, rec.batch_name, rec.import_day, rec.cnt
    WHERE NOT EXISTS (
      SELECT 1 FROM batches
      WHERE user_id = rec.user_id AND name = rec.batch_name
    );
  END LOOP;
END $$;
