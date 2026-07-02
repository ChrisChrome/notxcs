const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { requireAuth, ROLES } = require('../lib/auth');
const { generatePlaceId, generateApiKey, generateReaderId } = require('../lib/generators');

const KIT_TEMPLATE_PATH = path.join(__dirname, '..', 'xcs-template.rbxmx');

let db;

module.exports = (dbInit) => {
	db = dbInit;
	return router;
};

// Loads the place, granting access if the current user owns it, holds an elevated/admin role
// (which bypasses ownership checks entirely), or has been explicitly granted shared access to it.
function loadPlace(req, res, next) {
	const { placeId } = req.params;
	db.get(`SELECT * FROM places WHERE id = ?`, [placeId], (err, place) => {
		if (err) {
			console.error('Failed to retrieve place:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		if (!place) {
			return res.status(404).json({ success: false, message: "Place not found" });
		}

		if (place.ownerId === req.user.id) {
			req.place = place;
			req.placeAccessLevel = 'owner';
			return next();
		}

		if (req.user.role >= ROLES.ELEVATED) {
			req.place = place;
			req.placeAccessLevel = 'bypass';
			return next();
		}

		db.get(`SELECT 1 FROM place_access WHERE placeId = ? AND userId = ?`, [placeId, req.user.id], (err, grant) => {
			if (err) {
				console.error('Failed to check place access:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}
			if (!grant) {
				return res.status(404).json({ success: false, message: "Place not found" });
			}
			req.place = place;
			req.placeAccessLevel = 'shared';
			next();
		});
	});
}

// Only the owner (or an elevated/admin user, who bypasses ownership checks) may perform this action,
// e.g. deleting the place or managing who else has shared access to it.
function requireOwnerOrBypass(req, res, next) {
	if (req.placeAccessLevel === 'owner' || req.placeAccessLevel === 'bypass') {
		return next();
	}
	return res.status(403).json({ success: false, message: "Only the place owner or an elevated user can perform this action" });
}

router.use(requireAuth(() => db));

// List places owned by, or shared with, the current user. Elevated/admin users see every place.
// Includes the owner's username (as `ownerUsername`) so the sidebar can display who owns each place.
router.get('/places', (req, res) => {
	if (req.user.role >= ROLES.ELEVATED) {
		return db.all(
			`SELECT places.*, users.username AS ownerUsername FROM places LEFT JOIN users ON users.id = places.ownerId`,
			[],
			(err, places) => {
				if (err) {
					console.error('Failed to retrieve places:', err.message);
					return res.status(500).json({ success: false, message: "Internal server error" });
				}
				res.json({ success: true, places });
			}
		);
	}

	db.all(
		`SELECT places.*, users.username AS ownerUsername FROM places LEFT JOIN users ON users.id = places.ownerId WHERE places.ownerId = ? OR places.id IN (SELECT placeId FROM place_access WHERE userId = ?)`,
		[req.user.id, req.user.id],
		(err, places) => {
			if (err) {
				console.error('Failed to retrieve places:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}
			res.json({ success: true, places });
		}
	);
});

// Create a new place. Only admins (and superadmins) may supply a custom id/apiKey - everyone else
// always gets a generated (random UUID / random 64-char) id and apiKey. Admins that leave either
// field blank also get one generated for them.
router.post('/places', (req, res) => {
	const canSetCustomValues = req.user.role >= ROLES.ADMIN;
	const { settings } = req.body || {};
	let { id, apiKey, name } = req.body || {};

	if (!canSetCustomValues && (id || apiKey)) {
		return res.status(403).json({ success: false, message: "Only admins can set a custom place id or API key" });
	}

	// If we reach here, either the caller is an admin, or both id and apiKey were already falsy.
	id = id ? String(id).trim() : '';
	apiKey = apiKey ? String(apiKey).trim() : '';
	name = name ? String(name).trim() : '';

	if (!id) id = generatePlaceId();
	if (!apiKey) apiKey = generateApiKey();

	db.get(`SELECT id FROM places WHERE id = ?`, [id], (err, existing) => {
		if (err) {
			console.error('Failed to check for existing place:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		if (existing) {
			return res.status(409).json({ success: false, message: "A place with that id already exists" });
		}

		db.run(`INSERT INTO places (id, apiKey, settings, ownerId, name) VALUES (?, ?, ?, ?, ?)`, [id, apiKey, settings || '{}', req.user.id, name || null], (err) => {
			if (err) {
				console.error('Failed to create place:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}
			res.json({ success: true, place: { id, apiKey, settings: settings || '{}', ownerId: req.user.id, name: name || null } });
		});
	});
});

// Get a single place with its access points (readers)
router.get('/places/:placeId', loadPlace, (req, res) => {
	db.all(`SELECT * FROM access_points WHERE placeId = ?`, [req.place.id], (err, accessPoints) => {
		if (err) {
			console.error('Failed to retrieve access points:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true, place: req.place, accessPoints, accessLevel: req.placeAccessLevel });
	});
});

// Update a place's apiKey/settings. Only admins (and superadmins) may set a custom apiKey value -
// everyone else must use the regenerate-key endpoint below. Admins that explicitly send a blank
// apiKey get a freshly generated one instead of clearing it.
router.put('/places/:placeId', loadPlace, (req, res) => {
	const canSetCustomValues = req.user.role >= ROLES.ADMIN;

	if (req.body.apiKey !== undefined && !canSetCustomValues) {
		return res.status(403).json({ success: false, message: "Only admins can set a custom API key; use regenerate instead" });
	}

	let apiKey = req.place.apiKey;
	if (req.body.apiKey !== undefined) {
		apiKey = String(req.body.apiKey).trim() || generateApiKey();
	}
	const settings = req.body.settings !== undefined ? req.body.settings : req.place.settings;
	const name = req.body.name !== undefined ? (String(req.body.name).trim() || null) : req.place.name;

	db.run(`UPDATE places SET apiKey = ?, settings = ?, name = ? WHERE id = ?`, [apiKey, settings, name, req.place.id], (err) => {
		if (err) {
			console.error('Failed to update place:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true });
	});
});

// Regenerate a place's API key to a new random value. Anyone with access to the place (owner,
// shared access, or elevated/admin bypass) may do this - unlike setting a custom value, this
// doesn't require admin privileges since it never lets the caller choose the resulting key.
router.post('/places/:placeId/regenerate-key', loadPlace, (req, res) => {
	const apiKey = generateApiKey();

	db.run(`UPDATE places SET apiKey = ? WHERE id = ?`, [apiKey, req.place.id], (err) => {
		if (err) {
			console.error('Failed to regenerate API key:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true, apiKey });
	});
});

// Download the place's Roblox kit (xcs-template.rbxmx) with the placeId/apiKey placeholders
// filled in for this specific place. Available to anyone with access to the place.
router.get('/places/:placeId/kit', loadPlace, (req, res) => {
	fs.readFile(KIT_TEMPLATE_PATH, 'utf8', (err, template) => {
		if (err) {
			console.error('Failed to read kit template:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}

		const kit = template
			.split('%%PLACEID%%').join(req.place.id)
			.split('%%APIKEY%%').join(req.place.apiKey);

		const filename = `${(req.place.name || req.place.id).replace(/[^a-zA-Z0-9-_]/g, '_')}.rbxmx`;
		res.setHeader('Content-Type', 'application/xml');
		res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
		res.send(kit);
	});
});

// Delete a place (and its readers/acl entries/access groups/scan logs/shared access grants)
router.delete('/places/:placeId', loadPlace, requireOwnerOrBypass, (req, res) => {
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
				db.run(`DELETE FROM scan_logs WHERE accessPoint IN (${placeholders})`, apIds, (err) => {
					if (err) return cb(err);
					db.run(`DELETE FROM access_points WHERE placeId = ?`, [req.place.id], cb);
				});
			});
		};

		deleteAclAndAp((err) => {
			if (err) {
				console.error('Failed to delete readers for place:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}

			db.all(`SELECT id FROM access_groups WHERE placeId = ?`, [req.place.id], (err, groups) => {
				if (err) {
					console.error('Failed to retrieve access groups for place:', err.message);
					return res.status(500).json({ success: false, message: "Internal server error" });
				}

				const groupIds = groups.map(g => g.id);
				const deleteGroups = (cb) => {
					if (groupIds.length === 0) return cb();
					const placeholders = groupIds.map(() => '?').join(',');
					db.run(`DELETE FROM access_group_members WHERE groupId IN (${placeholders})`, groupIds, (err) => {
						if (err) return cb(err);
						db.run(`DELETE FROM access_groups WHERE placeId = ?`, [req.place.id], cb);
					});
				};

				deleteGroups((err) => {
					if (err) {
						console.error('Failed to delete access groups for place:', err.message);
						return res.status(500).json({ success: false, message: "Internal server error" });
					}

					db.run(`DELETE FROM place_access WHERE placeId = ?`, [req.place.id], (err) => {
						if (err) {
							console.error('Failed to delete access grants for place:', err.message);
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

// Create a new reader (access point) for a place. The reader id is always
// generated server-side as a random 16-character alphanumeric string; no
// caller-supplied id is ever accepted.
router.post('/places/:placeId/access-points', loadPlace, (req, res) => {
	const { name } = req.body || {};
	if (!name) {
		return res.status(400).json({ success: false, message: "Reader name is required" });
	}

	const enabled = req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : 1;
	const unlockTime = req.body.unlockTime !== undefined ? req.body.unlockTime : 8;
	const armState = req.body.armState !== undefined ? req.body.armState : 1;

	function tryInsert(attemptsLeft) {
		const id = generateReaderId();
		db.get(`SELECT id FROM access_points WHERE id = ?`, [id], (err, existing) => {
			if (err) {
				console.error('Failed to check for existing reader:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}
			if (existing) {
				if (attemptsLeft <= 0) {
					return res.status(500).json({ success: false, message: "Failed to generate a unique reader id" });
				}
				return tryInsert(attemptsLeft - 1);
			}

			db.run(
				`INSERT INTO access_points (id, placeId, name, enabled, unlockTime, armState) VALUES (?, ?, ?, ?, ?, ?)`,
				[id, req.place.id, name, enabled, unlockTime, armState],
				(err) => {
					if (err) {
						console.error('Failed to create reader:', err.message);
						return res.status(500).json({ success: false, message: "Internal server error" });
					}
					res.json({ success: true, id });
				}
			);
		});
	}

	tryInsert(5);
});

// Update a reader's settings
router.put('/places/:placeId/access-points/:accessPointId', loadPlace, loadOwnedAccessPoint, (req, res) => {
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
router.delete('/places/:placeId/access-points/:accessPointId', loadPlace, loadOwnedAccessPoint, (req, res) => {
	db.run(`DELETE FROM acl WHERE accessPoint = ?`, [req.accessPoint.id], (err) => {
		if (err) {
			console.error('Failed to delete ACL entries for reader:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		db.run(`DELETE FROM scan_logs WHERE accessPoint = ?`, [req.accessPoint.id], (err) => {
			if (err) {
				console.error('Failed to delete scan logs for reader:', err.message);
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
});

// List scan logs for a reader (most recent first)
router.get('/places/:placeId/access-points/:accessPointId/logs', loadPlace, loadOwnedAccessPoint, (req, res) => {
	const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
	db.all(
		`SELECT * FROM scan_logs WHERE accessPoint = ? ORDER BY scannedAt DESC, id DESC LIMIT ?`,
		[req.accessPoint.id, limit],
		(err, logs) => {
			if (err) {
				console.error('Failed to retrieve scan logs:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}
			res.json({ success: true, logs });
		}
	);
});

// List ACL entries for a reader
router.get('/places/:placeId/access-points/:accessPointId/acl', loadPlace, loadOwnedAccessPoint, (req, res) => {
	db.all(`SELECT * FROM acl WHERE accessPoint = ?`, [req.accessPoint.id], (err, entries) => {
		if (err) {
			console.error('Failed to retrieve ACL entries:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true, acl: entries });
	});
});

// Add an ACL entry for a reader
router.post('/places/:placeId/access-points/:accessPointId/acl', loadPlace, loadOwnedAccessPoint, (req, res) => {
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
router.delete('/places/:placeId/access-points/:accessPointId/acl/:aclId', loadPlace, loadOwnedAccessPoint, (req, res) => {
	db.run(`DELETE FROM acl WHERE id = ? AND accessPoint = ?`, [req.params.aclId, req.accessPoint.id], (err) => {
		if (err) {
			console.error('Failed to delete ACL entry:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true });
	});
});

function loadOwnedAccessGroup(req, res, next) {
	db.get(`SELECT * FROM access_groups WHERE id = ? AND placeId = ?`, [req.params.groupId, req.place.id], (err, group) => {
		if (err) {
			console.error('Failed to retrieve access group:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		if (!group) {
			return res.status(404).json({ success: false, message: "Access group not found" });
		}
		req.accessGroup = group;
		next();
	});
}

// List access groups for a place
router.get('/places/:placeId/access-groups', loadPlace, (req, res) => {
	db.all(`SELECT * FROM access_groups WHERE placeId = ?`, [req.place.id], (err, groups) => {
		if (err) {
			console.error('Failed to retrieve access groups:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true, groups });
	});
});

// Create an access group (e.g. "Staff") for a place
router.post('/places/:placeId/access-groups', loadPlace, (req, res) => {
	const { name } = req.body || {};
	if (!name) {
		return res.status(400).json({ success: false, message: "Access group name is required" });
	}

	db.run(`INSERT INTO access_groups (placeId, name) VALUES (?, ?)`, [req.place.id, name], function (err) {
		if (err) {
			console.error('Failed to create access group:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true, group: { id: this.lastID, placeId: req.place.id, name } });
	});
});

// Rename an access group
router.put('/places/:placeId/access-groups/:groupId', loadPlace, loadOwnedAccessGroup, (req, res) => {
	const name = req.body.name !== undefined ? req.body.name : req.accessGroup.name;
	if (!name) {
		return res.status(400).json({ success: false, message: "Access group name is required" });
	}

	db.run(`UPDATE access_groups SET name = ? WHERE id = ?`, [name, req.accessGroup.id], (err) => {
		if (err) {
			console.error('Failed to update access group:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true });
	});
});

// Delete an access group (and its members, and any ACL entries referencing it)
router.delete('/places/:placeId/access-groups/:groupId', loadPlace, loadOwnedAccessGroup, (req, res) => {
	db.run(`DELETE FROM access_group_members WHERE groupId = ?`, [req.accessGroup.id], (err) => {
		if (err) {
			console.error('Failed to delete access group members:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		// Access group ACL entries store the group id in `data` with type 5.
		db.run(`DELETE FROM acl WHERE type = 5 AND data = ?`, [String(req.accessGroup.id)], (err) => {
			if (err) {
				console.error('Failed to delete ACL entries referencing access group:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}
			db.run(`DELETE FROM access_groups WHERE id = ?`, [req.accessGroup.id], (err) => {
				if (err) {
					console.error('Failed to delete access group:', err.message);
					return res.status(500).json({ success: false, message: "Internal server error" });
				}
				res.json({ success: true });
			});
		});
	});
});

// List members (creds) of an access group
router.get('/places/:placeId/access-groups/:groupId/members', loadPlace, loadOwnedAccessGroup, (req, res) => {
	db.all(`SELECT * FROM access_group_members WHERE groupId = ?`, [req.accessGroup.id], (err, members) => {
		if (err) {
			console.error('Failed to retrieve access group members:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true, members });
	});
});

// Add a member (user, card, group rank rule, etc) to an access group
router.post('/places/:placeId/access-groups/:groupId/members', loadPlace, loadOwnedAccessGroup, (req, res) => {
	const { type, data } = req.body || {};
	if (type === undefined || !data) {
		return res.status(400).json({ success: false, message: "Member type and data are required" });
	}
	// Groups cannot contain other groups, to avoid nested/circular resolution.
	if (parseInt(type, 10) === 5) {
		return res.status(400).json({ success: false, message: "An access group cannot contain another access group, to prevent circular/nested resolution" });
	}

	db.run(`INSERT INTO access_group_members (groupId, type, data) VALUES (?, ?, ?)`, [req.accessGroup.id, type, data], function (err) {
		if (err) {
			console.error('Failed to add access group member:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true, id: this.lastID });
	});
});

// Remove a member from an access group
router.delete('/places/:placeId/access-groups/:groupId/members/:memberId', loadPlace, loadOwnedAccessGroup, (req, res) => {
	db.run(`DELETE FROM access_group_members WHERE id = ? AND groupId = ?`, [req.params.memberId, req.accessGroup.id], (err) => {
		if (err) {
			console.error('Failed to remove access group member:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true });
	});
});

// --- Shared place access (lets an owner grant other users access to a place's settings) ---

// List users who have been granted shared access to this place
router.get('/places/:placeId/access', loadPlace, requireOwnerOrBypass, (req, res) => {
	db.all(
		`SELECT place_access.id, place_access.userId, users.username, place_access.createdAt
		 FROM place_access JOIN users ON users.id = place_access.userId
		 WHERE place_access.placeId = ?`,
		[req.place.id],
		(err, grants) => {
			if (err) {
				console.error('Failed to retrieve access grants:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}
			res.json({ success: true, grants });
		}
	);
});

// Grant another user access to this place's settings, by username
router.post('/places/:placeId/access', loadPlace, requireOwnerOrBypass, (req, res) => {
	const { username } = req.body || {};
	if (!username) {
		return res.status(400).json({ success: false, message: "Username is required" });
	}

	db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
		if (err) {
			console.error('Failed to look up user:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		if (!user) {
			return res.status(404).json({ success: false, message: "No user with that username was found" });
		}
		if (user.id === req.place.ownerId) {
			return res.status(400).json({ success: false, message: "The place owner already has full access" });
		}

		db.run(
			`INSERT INTO place_access (placeId, userId, grantedBy) VALUES (?, ?, ?)`,
			[req.place.id, user.id, req.user.id],
			function (err) {
				if (err) {
					if (err.message && err.message.includes('UNIQUE')) {
						return res.status(409).json({ success: false, message: "That user already has access to this place" });
					}
					console.error('Failed to grant place access:', err.message);
					return res.status(500).json({ success: false, message: "Internal server error" });
				}
				res.json({ success: true, grant: { id: this.lastID, placeId: req.place.id, userId: user.id, username } });
			}
		);
	});
});

// Revoke a user's shared access to this place
router.delete('/places/:placeId/access/:userId', loadPlace, requireOwnerOrBypass, (req, res) => {
	db.run(`DELETE FROM place_access WHERE placeId = ? AND userId = ?`, [req.place.id, req.params.userId], (err) => {
		if (err) {
			console.error('Failed to revoke place access:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true });
	});
});

