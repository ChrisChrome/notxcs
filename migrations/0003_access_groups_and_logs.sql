CREATE TABLE IF NOT EXISTS access_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, placeId TEXT NOT NULL, name TEXT NOT NULL, FOREIGN KEY(placeId) REFERENCES places(id));

CREATE TABLE IF NOT EXISTS access_group_members (id INTEGER PRIMARY KEY AUTOINCREMENT, groupId INTEGER NOT NULL, type INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, FOREIGN KEY(groupId) REFERENCES access_groups(id));

CREATE TABLE IF NOT EXISTS scan_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, placeId TEXT NOT NULL, accessPoint TEXT NOT NULL, userId TEXT, cardNumbers TEXT, granted INTEGER NOT NULL DEFAULT 0, responseCode TEXT, scannedAt DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(placeId) REFERENCES places(id), FOREIGN KEY(accessPoint) REFERENCES access_points(id));

CREATE INDEX IF NOT EXISTS idx_access_group_members_groupId ON access_group_members(groupId);

CREATE INDEX IF NOT EXISTS idx_scan_logs_accessPoint ON scan_logs(accessPoint);

CREATE INDEX IF NOT EXISTS idx_scan_logs_placeId ON scan_logs(placeId);
