let db;
const express = require('express');
const router = express.Router();

module.exports = (dbInit) => {
	db = dbInit;
	return router;
};


router.get('/', (req, res) => {
	res.json({ success: true, message: "Welcome to the NOTXCS API!" });
});
router.get('/ping', (req, res) => {
	// TODO: Implement a more robust health check. Probably will revolve around checking db conn and others.
	res.json({ success: true, message: "pong" });
});

router.get('/:placeId', (req, res) => {
	const placeId = req.params.placeId;
	const apiKey = req.query.apiKey;
	const universeid = req.query.universeid;

	// For some reason the official XCS api doesn't actually check the api key when getting settings? So we won't either.
	// XCS Also ignores universe ID. Probably used for some logging. We will ignore it.
	if (!placeId) {
		return res.status(404).json({ success: false, message: "What? How?" });
	}

	db.get(`SELECT * FROM places WHERE id = ?`, [placeId], (err, row) => {
		if (err) {
			console.error('Failed to retrieve place settings:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}

		if (!row) {
			return res.status(404).json({ success: false, message: "Place not found" });
		}

		db.all(`SELECT * FROM access_points WHERE placeId = ?`, [placeId], (err, accessPoints) => {
			if (err) {
				console.error('Failed to retrieve access points:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}

			let resp = {
				success: true,
				accessPoints: accessPoints.reduce((acc, ap) => {
					const armed = !!ap.armState; // Will have state 2 eventually for armed on schedule, but for now just 1 or 0.

					acc[ap.id] = {
						id: ap.id,
						name: ap.name,
						unlockTime: ap.unlockTime,
						config: {
							active: !!ap.enabled,
							armed,
							scanData: {
								ready: JSON.parse(ap.readyData || '{}'),
								disarmed: JSON.parse(ap.disarmedData || '{}')
							}
						}
					}
					return acc;
				}, {})
			};
			console.log(resp)
			res.json(resp);
		});
	});
});

router.get('/:placeId/:accessPointId/onScan', async (req, res) => {
	// This one DOES check api key.
	const placeId = req.params.placeId;
	const accessPointId = req.params.accessPointId;
	const apiKey = req.query.apiKey;
	const userId = req.query.userId;
	const cardNumbers = req.query.cardNumbers ? req.query.cardNumbers.split(',') : [];
	const universeid = req.query.universeid || '0';

	if (!placeId || !accessPointId) {
		return res.status(404).json({ success: false, message: "What? How?" });
	}

	if (!apiKey) {
		return res.status(400).json({ success: false, message: "API key is required" });
	}

	db.get(`SELECT * FROM places WHERE id = ? AND apiKey = ?`, [placeId, apiKey], (err, place) => {
		if (err) {
			console.error('Failed to retrieve place settings:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}

		if (!place) {
			return res.status(404).json({ success: false, message: "Place not found or invalid API key" });
		}

		db.get(`SELECT * FROM access_points WHERE id = ? AND placeId = ?`, [accessPointId, placeId], (err, ap) => {
			if (err) {
				console.error('Failed to retrieve access point:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}

			if (!ap) {
				return res.status(404).json({ success: false, message: "Access point not found" });
			}

			db.all(`SELECT * FROM acl WHERE accessPoint = ?`, [accessPointId], async (err, aclEntries) => {
				if (err) {
					console.error('Failed to retrieve ACL entries:', err.message);
					return res.status(500).json({ success: false, message: "Internal server error" });
				}

				// Access group entries (type 5) reference an access_groups.id in `data`. Resolve their
				// members up front so the group's users/cards/ranks are checked just like direct entries.
				const groupIds = [...new Set(aclEntries.filter(e => e.type === 5).map(e => e.data))];
				let groupMembersById = {};
				if (groupIds.length > 0) {
					const placeholders = groupIds.map(() => '?').join(',');
					groupMembersById = await new Promise((resolve) => {
						db.all(`SELECT * FROM access_group_members WHERE groupId IN (${placeholders})`, groupIds, (err, members) => {
							if (err) {
								console.error('Failed to retrieve access group members:', err.message);
								return resolve({});
							}
							const byGroup = {};
							for (const member of members) {
								if (!byGroup[member.groupId]) byGroup[member.groupId] = [];
								byGroup[member.groupId].push(member);
							}
							resolve(byGroup);
						});
					});
				}

				let userGroups = await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`).then(r => r.json()).then(data => data.data || []).catch(() => []);
				userGroups = userGroups.map(g => ({group: g.group.id, rank: g.role.rank}));
				console.log('User groups:', userGroups);

				// Types: 0 = User ID; 1 = Card Number; 2 = Group Exact Rank; 3 = Group Min Rank; 4 = Allow All; 5 = Access Group
				function matchesEntry(entry) {
					switch (entry.type) {
						case 0: // User ID
							return entry.data == userId;
						case 1: // Card Number
							return cardNumbers.includes(entry.data);
						case 2: { // Group Exact Rank
							const [group, rank] = entry.data.split(':');
							return userGroups.some(g => g.group == group && g.rank == rank);
						}
						case 3: { // Group Min Rank
							const [group, rank] = entry.data.split(':');
							return userGroups.some(g => g.group == group && g.rank >= rank);
						}
						case 4: // Allow All
							return true;
						case 5: // Access Group - granted if any credential in the group matches.
							return (groupMembersById[entry.data] || []).some(matchesEntry);
						default:
							return false;
					}
				}

				let granted = false;
				// Check every entry (users, cards, group ranks, then access groups made up of the above).
				for (const entry of aclEntries) {
					if (matchesEntry(entry)) {
						granted = true;
						break;
					}
				}

				const responseCode = granted ? 'access_granted' : 'access_denied';
				db.run(
					`INSERT INTO scan_logs (placeId, accessPoint, userId, cardNumbers, granted, responseCode) VALUES (?, ?, ?, ?, ?, ?)`,
					[placeId, accessPointId, userId || null, cardNumbers.join(','), granted ? 1 : 0, responseCode],
					(err) => {
						if (err) console.error('Failed to record scan log:', err.message);
					}
				);

				const responseData = granted ? {
					success: true,
					grant_type: 'user_scan',
					response_code: 'access_granted',
					response_time: 0, // This is just analytics for how long their backend took to generate the response
					scan_data: JSON.parse(ap.grantedData || '{}')
				} : {
					success: true,
					grant_type: 'user_scan',
					response_code: 'access_denied',
					response_time: 0,
					scan_data: JSON.parse(ap.deniedData || '{}')
				}
				res.json(responseData);
			});
		});
	});
});