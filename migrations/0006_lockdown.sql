-- Single-row table holding the global lockdown state. When active, every reader at every place
-- is disabled and all scans are denied, regardless of that reader's own enabled/armState/ACL config.
CREATE TABLE IF NOT EXISTS system_lockdown (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	active INTEGER NOT NULL DEFAULT 0,
	activatedBy INTEGER,
	activatedAt DATETIME,
	FOREIGN KEY(activatedBy) REFERENCES users(id)
);

INSERT OR IGNORE INTO system_lockdown (id, active) VALUES (1, 0);
