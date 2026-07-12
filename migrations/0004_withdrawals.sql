-- Distinguish self-withdrawal from disciplinary/organizer removal
ALTER TABLE participants ADD COLUMN removed_reason TEXT; -- 'withdrew' | 'strikes' | 'organizer'
