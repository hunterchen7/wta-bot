-- Problem authoring is now structured instead of relying on one Markdown blob.
-- Legacy columns remain as compatibility indexes for existing packet consumers.
ALTER TABLE problems ADD COLUMN interviewer_notes_md TEXT;
ALTER TABLE problems ADD COLUMN execution_json TEXT;

UPDATE problems
SET interviewer_notes_md = CASE
  WHEN trim(COALESCE(hints_md, '')) <> '' AND trim(COALESCE(solution_md, '')) <> ''
    THEN trim(hints_md) || char(10) || char(10) || '## Intended solution' || char(10) || char(10) || trim(solution_md)
  WHEN trim(COALESCE(hints_md, '')) <> '' THEN trim(hints_md)
  WHEN trim(COALESCE(solution_md, '')) <> ''
    THEN '## Intended solution' || char(10) || char(10) || trim(solution_md)
  ELSE ''
END;
