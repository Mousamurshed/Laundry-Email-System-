-- Strip leading/trailing angle brackets or parentheses from email addresses
-- e.g. <email@gmail.com> → email@gmail.com
--      (email@gmail.com) → email@gmail.com

UPDATE contacts
SET email = TRIM(BOTH FROM SUBSTRING(TRIM(email) FROM 2 FOR LENGTH(TRIM(email)) - 2))
WHERE TRIM(email) ~ '^[<(].+[>)]$';

UPDATE email_history
SET to_email = TRIM(BOTH FROM SUBSTRING(TRIM(to_email) FROM 2 FOR LENGTH(TRIM(to_email)) - 2))
WHERE TRIM(to_email) ~ '^[<(].+[>)]$';
