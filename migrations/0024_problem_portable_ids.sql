-- Stable opaque identity for portable question exports.
-- Integer problem IDs remain the local relational key; portable_id is the
-- opaque identity carried into Pairy question packs and used for idempotent
-- imports. The trigger covers every insert path, including tests and scripts.

ALTER TABLE problems ADD COLUMN portable_id TEXT;

UPDATE problems
SET portable_id = lower(hex(randomblob(16)))
WHERE portable_id IS NULL;

CREATE UNIQUE INDEX idx_problems_portable_id ON problems(portable_id);

CREATE TRIGGER problems_assign_portable_id
AFTER INSERT ON problems
WHEN NEW.portable_id IS NULL
BEGIN
  UPDATE problems
  SET portable_id = lower(hex(randomblob(16)))
  WHERE id = NEW.id;
END;

CREATE TRIGGER problems_keep_portable_id
BEFORE UPDATE OF portable_id ON problems
WHEN OLD.portable_id IS NOT NULL
  AND (NEW.portable_id IS NULL OR NEW.portable_id <> OLD.portable_id)
BEGIN
  SELECT RAISE(ABORT, 'problem portable_id is immutable');
END;
