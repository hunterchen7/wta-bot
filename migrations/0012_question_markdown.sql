-- A question is authored as one Markdown document. The existing section
-- columns remain as a runtime compatibility index for packet visibility.
ALTER TABLE problems ADD COLUMN content_md TEXT;
ALTER TABLE problems ADD COLUMN available_weeks TEXT NOT NULL DEFAULT '[]';

UPDATE problems SET
  content_md = '## Statement' || char(10) || char(10) || COALESCE(statement_md, '') ||
    char(10) || char(10) || '## Hints' || char(10) || char(10) || COALESCE(hints_md, '') ||
    char(10) || char(10) || '## Solution' || char(10) || char(10) || COALESCE(solution_md, ''),
  available_weeks = CASE
    WHEN difficulty = 'easy' THEN '[1]'
    WHEN difficulty = 'medium' AND COALESCE(difficulty_rank, 2.0) < 2.5 THEN '[2]'
    ELSE '[3]'
  END;
