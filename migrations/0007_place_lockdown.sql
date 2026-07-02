-- Per-place lockdown, separate from the global (all-places) lockdown in system_lockdown. Unlike the
-- global lockdown, this can be engaged/lifted by anyone with access to the place (owner, shared
-- access, or elevated/admin bypass) - see routes/dashboard.js.
ALTER TABLE places ADD COLUMN lockdown INTEGER NOT NULL DEFAULT 0;
ALTER TABLE places ADD COLUMN lockdownActivatedBy INTEGER REFERENCES users(id);
ALTER TABLE places ADD COLUMN lockdownActivatedAt DATETIME;
