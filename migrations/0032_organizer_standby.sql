-- Organizers stay excluded from normal matching, but may explicitly volunteer
-- for role-specific standby assignments.
ALTER TABLE optins ADD COLUMN standby_override_exclusion INTEGER NOT NULL DEFAULT 0;
