ALTER TABLE users ADD COLUMN role INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS place_access (id INTEGER PRIMARY KEY AUTOINCREMENT, placeId TEXT NOT NULL, userId INTEGER NOT NULL, grantedBy INTEGER, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(placeId) REFERENCES places(id), FOREIGN KEY(userId) REFERENCES users(id), FOREIGN KEY(grantedBy) REFERENCES users(id), UNIQUE(placeId, userId));

CREATE INDEX IF NOT EXISTS idx_place_access_userId ON place_access(userId);

CREATE INDEX IF NOT EXISTS idx_place_access_placeId ON place_access(placeId);
