const express = require('express');
const router = express.Router();

let db;

module.exports = (dbInit) => {
	db = dbInit;
	return router;
};

function requireAuth(req, res, next) {
	if (!req.session || !req.session.userId) {
		return res.status(401).json({ success: false, message: "Not authenticated" });
	}
	next();
}

function loadOwnedPlace(req, res, next) {
	const { placeId } = req.params;
	db.get(`SELECT * FROM places WHERE id = ? AND ownerId = ?`, [placeId, req.session.userId], (err, place) => {
		if (err) {
			console.error('Failed to retrieve place:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		if (!place) {
			return res.status(404).json({ success: false, message: "Place not found" });
		}
		req.place = place;
		next();
	});
}

router.use(requireAuth);

// List places owned by the current user
router.get('/places', (req, res) => {
	db.all(`SELECT * FROM places WHERE ownerId = ?`, [req.session.userId], (err, places) => {
		if (err) {
			console.error('Failed to retrieve places:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true, places });
	});
});

// Create a new place
router.post('/places', (req, res) => {
	const { id, apiKey, settings } = req.body || {};
	if (!id || !apiKey) {
		return res.status(400).json({ success: false, message: "Place id and apiKey are required" });
	}

	db.get(`SELECT id FROM places WHERE id = ?`, [id], (err, existing) => {
		if (err) {
			console.error('Failed to check for existing place:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		if (existing) {
			return res.status(409).json({ success: false, message: "A place with that id already exists" });
		}

		db.run(`INSERT INTO places (id, apiKey, settings, ownerId) VALUES (?, ?, ?, ?)`, [id, apiKey, settings || '{}', req.session.userId], (err) => {
			if (err) {
				console.error('Failed to create place:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}
			res.json({ success: true, place: { id, apiKey, settings: settings || '{}', ownerId: req.session.userId } });
		});
	});
});

// Get a single place with its access points (readers)
router.get('/places/:placeId', loadOwnedPlace, (req, res) => {
	db.all(`SELECT * FROM access_points WHERE placeId = ?`, [req.place.id], (err, accessPoints) => {
		if (err) {
			console.error('Failed to retrieve access points:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true, place: req.place, accessPoints });
	});
});

// Update a place's apiKey/settings
router.put('/places/:placeId', loadOwnedPlace, (req, res) => {
	const apiKey = req.body.apiKey !== undefined ? req.body.apiKey : req.place.apiKey;
	const settings = req.body.settings !== undefined ? req.body.settings : req.place.settings;

	db.run(`UPDATE places SET apiKey = ?, settings = ? WHERE id = ?`, [apiKey, settings, req.place.id], (err) => {
		if (err) {
			console.error('Failed to update place:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true });
	});
});

// Delete a place (and its readers/acl entries)
router.delete('/places/:placeId', loadOwnedPlace, (req, res) => {
	db.all(`SELECT id FROM access_points WHERE placeId = ?`, [req.place.id], (err, accessPoints) => {
		if (err) {
			console.error('Failed to retrieve access points:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}

		const apIds = accessPoints.map(ap => ap.id);
		const deleteAclAndAp = (cb) => {
			if (apIds.length === 0) return cb();
			// Build a `?` placeholder per id so all values stay parameterized; apIds never contains raw user input here.
			const placeholders = apIds.map(() => '?').join(',');
			db.run(`DELETE FROM acl WHERE accessPoint IN (${placeholders})`, apIds, (err) => {
				if (err) return cb(err);
				db.run(`DELETE FROM access_points WHERE placeId = ?`, [req.place.id], cb);
			});
		};

		deleteAclAndAp((err) => {
			if (err) {
				console.error('Failed to delete readers for place:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}

			db.run(`DELETE FROM places WHERE id = ?`, [req.place.id], (err) => {
				if (err) {
					console.error('Failed to delete place:', err.message);
					return res.status(500).json({ success: false, message: "Internal server error" });
				}
				res.json({ success: true });
			});
		});
	});
});

function loadOwnedAccessPoint(req, res, next) {
	db.get(`SELECT * FROM access_points WHERE id = ? AND placeId = ?`, [req.params.accessPointId, req.place.id], (err, ap) => {
		if (err) {
			console.error('Failed to retrieve reader:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		if (!ap) {
			return res.status(404).json({ success: false, message: "Reader not found" });
		}
		req.accessPoint = ap;
		next();
	});
}

// Create a new reader (access point) for a place
router.post('/places/:placeId/access-points', loadOwnedPlace, (req, res) => {
	const { id, name } = req.body || {};
	if (!id || !name) {
		return res.status(400).json({ success: false, message: "Reader id and name are required" });
	}

	const enabled = req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : 1;
	const unlockTime = req.body.unlockTime !== undefined ? req.body.unlockTime : 8;
	const armState = req.body.armState !== undefined ? req.body.armState : 1;

	db.get(`SELECT id FROM access_points WHERE id = ?`, [id], (err, existing) => {
		if (err) {
			console.error('Failed to check for existing reader:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		if (existing) {
			return res.status(409).json({ success: false, message: "A reader with that id already exists" });
		}

		db.run(
			`INSERT INTO access_points (id, placeId, name, enabled, unlockTime, armState) VALUES (?, ?, ?, ?, ?, ?)`,
			[id, req.place.id, name, enabled, unlockTime, armState],
			(err) => {
				if (err) {
					console.error('Failed to create reader:', err.message);
					return res.status(500).json({ success: false, message: "Internal server error" });
				}
				res.json({ success: true });
			}
		);
	});
});

// Update a reader's settings
router.put('/places/:placeId/access-points/:accessPointId', loadOwnedPlace, loadOwnedAccessPoint, (req, res) => {
	const ap = req.accessPoint;
	const name = req.body.name !== undefined ? req.body.name : ap.name;
	const enabled = req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : ap.enabled;
	const unlockTime = req.body.unlockTime !== undefined ? req.body.unlockTime : ap.unlockTime;
	const armState = req.body.armState !== undefined ? req.body.armState : ap.armState;
	const readyData = req.body.readyData !== undefined ? req.body.readyData : ap.readyData;
	const disarmedData = req.body.disarmedData !== undefined ? req.body.disarmedData : ap.disarmedData;
	const grantedData = req.body.grantedData !== undefined ? req.body.grantedData : ap.grantedData;
	const deniedData = req.body.deniedData !== undefined ? req.body.deniedData : ap.deniedData;

	db.run(
		`UPDATE access_points SET name = ?, enabled = ?, unlockTime = ?, armState = ?, readyData = ?, disarmedData = ?, grantedData = ?, deniedData = ? WHERE id = ?`,
		[name, enabled, unlockTime, armState, readyData, disarmedData, grantedData, deniedData, ap.id],
		(err) => {
			if (err) {
				console.error('Failed to update reader:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}
			res.json({ success: true });
		}
	);
});

// Delete a reader
router.delete('/places/:placeId/access-points/:accessPointId', loadOwnedPlace, loadOwnedAccessPoint, (req, res) => {
	db.run(`DELETE FROM acl WHERE accessPoint = ?`, [req.accessPoint.id], (err) => {
		if (err) {
			console.error('Failed to delete ACL entries for reader:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		db.run(`DELETE FROM access_points WHERE id = ?`, [req.accessPoint.id], (err) => {
			if (err) {
				console.error('Failed to delete reader:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}
			res.json({ success: true });
		});
	});
});

// List ACL entries for a reader
router.get('/places/:placeId/access-points/:accessPointId/acl', loadOwnedPlace, loadOwnedAccessPoint, (req, res) => {
	db.all(`SELECT * FROM acl WHERE accessPoint = ?`, [req.accessPoint.id], (err, entries) => {
		if (err) {
			console.error('Failed to retrieve ACL entries:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true, acl: entries });
	});
});

// Add an ACL entry for a reader
router.post('/places/:placeId/access-points/:accessPointId/acl', loadOwnedPlace, loadOwnedAccessPoint, (req, res) => {
	const { type, data } = req.body || {};
	if (type === undefined || !data) {
		return res.status(400).json({ success: false, message: "ACL type and data are required" });
	}

	db.run(`INSERT INTO acl (accessPoint, type, data) VALUES (?, ?, ?)`, [req.accessPoint.id, type, data], function (err) {
		if (err) {
			console.error('Failed to create ACL entry:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true, id: this.lastID });
	});
});

// Delete an ACL entry
router.delete('/places/:placeId/access-points/:accessPointId/acl/:aclId', loadOwnedPlace, loadOwnedAccessPoint, (req, res) => {
	db.run(`DELETE FROM acl WHERE id = ? AND accessPoint = ?`, [req.params.aclId, req.accessPoint.id], (err) => {
		if (err) {
			console.error('Failed to delete ACL entry:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true });
	});
});

