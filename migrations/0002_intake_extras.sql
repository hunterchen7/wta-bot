-- Optional intake paragraphs (modal 3): open-ended interests + prior-year feedback
ALTER TABLE participants ADD COLUMN interests TEXT;
ALTER TABLE participants ADD COLUMN prior_feedback TEXT;
