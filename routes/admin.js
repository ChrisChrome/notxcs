const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { requireAuth, ROLES } = require('../lib/auth');

let db;

module.exports = (dbInit) => {
	db = dbInit;
	return router;
};

// Admins (and superadmins) can administrate users: create, delete, reset password, change role.
router.use(requireAuth(() => db, ROLES.ADMIN));

// Superadmin (role 4) can never be granted through the API — the only way to obtain that role is by
// editing the database directly (see routes/auth.js, which grants it to the very first registered user).
const VALID_ROLES = [ROLES.USER, ROLES.ELEVATED, ROLES.ADMIN];

// Only a superadmin may grant the admin role to someone else.
function canAssignRole(callerRole, role) {
	if (role === ROLES.ADMIN) {
		return callerRole >= ROLES.SUPERADMIN;
	}
	return true;
}

// Regular admins may not modify or delete admin/superadmin accounts; only a superadmin can.
function canManageTarget(callerRole, targetRole) {
	if (callerRole >= ROLES.SUPERADMIN) {
		return true;
	}
	return targetRole < ROLES.ADMIN;
}

// List all users
router.get('/users', (req, res) => {
	db.all(`SELECT id, username, role, created_at FROM users ORDER BY id`, [], (err, users) => {
		if (err) {
			console.error('Failed to retrieve users:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.json({ success: true, users });
	});
});

// Create a new user
router.post('/users', (req, res) => {
	const { username, password } = req.body || {};
	const role = req.body.role !== undefined ? parseInt(req.body.role, 10) : ROLES.USER;

	if (!username || !password) {
		return res.status(400).json({ success: false, message: "Username and password are required" });
	}
	if (typeof username !== 'string' || typeof password !== 'string' || username.trim().length < 3 || password.length < 6) {
		return res.status(400).json({ success: false, message: "Username must be at least 3 characters and password at least 6 characters" });
	}
	if (!VALID_ROLES.includes(role)) {
		return res.status(400).json({ success: false, message: "Invalid role" });
	}
	if (!canAssignRole(req.user.role, role)) {
		return res.status(403).json({ success: false, message: "Only a superadmin can grant the admin role" });
	}

	db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, existing) => {
		if (err) {
			console.error('Failed to check for existing user:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		if (existing) {
			return res.status(409).json({ success: false, message: "Username is already taken" });
		}

		bcrypt.hash(password, 10, (err, hash) => {
			if (err) {
				console.error('Failed to hash password:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}

			db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, [username, hash, role], function (err) {
				if (err) {
					console.error('Failed to create user:', err.message);
					return res.status(500).json({ success: false, message: "Internal server error" });
				}
				res.json({ success: true, user: { id: this.lastID, username, role } });
			});
		});
	});
});

// Update a user's role and/or reset their password
router.put('/users/:userId', (req, res) => {
	const userId = parseInt(req.params.userId, 10);

	db.get(`SELECT id, username, role FROM users WHERE id = ?`, [userId], (err, user) => {
		if (err) {
			console.error('Failed to retrieve user:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		if (!user) {
			return res.status(404).json({ success: false, message: "User not found" });
		}
		if (!canManageTarget(req.user.role, user.role)) {
			return res.status(403).json({ success: false, message: "Only a superadmin can modify an admin or superadmin account" });
		}

		let role = user.role;
		if (req.body && req.body.role !== undefined) {
			role = parseInt(req.body.role, 10);
			if (!VALID_ROLES.includes(role)) {
				return res.status(400).json({ success: false, message: "Invalid role" });
			}
			if (!canAssignRole(req.user.role, role)) {
				return res.status(403).json({ success: false, message: "Only a superadmin can grant the admin role" });
			}
		}

		const password = req.body ? req.body.password : undefined;
		if (password !== undefined && (typeof password !== 'string' || password.length < 6)) {
			return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
		}

		const applyUpdate = (hash) => {
			const sql = hash
				? `UPDATE users SET role = ?, password = ? WHERE id = ?`
				: `UPDATE users SET role = ? WHERE id = ?`;
			const params = hash ? [role, hash, userId] : [role, userId];

			db.run(sql, params, (err) => {
				if (err) {
					console.error('Failed to update user:', err.message);
					return res.status(500).json({ success: false, message: "Internal server error" });
				}
				res.json({ success: true, user: { id: userId, username: user.username, role } });
			});
		};

		if (!password) {
			return applyUpdate(null);
		}

		bcrypt.hash(password, 10, (err, hash) => {
			if (err) {
				console.error('Failed to hash password:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}
			applyUpdate(hash);
		});
	});
});

// Delete a user
router.delete('/users/:userId', (req, res) => {
	const userId = parseInt(req.params.userId, 10);

	if (userId === req.user.id) {
		return res.status(400).json({ success: false, message: "You cannot delete your own account" });
	}

	db.get(`SELECT id, role FROM users WHERE id = ?`, [userId], (err, user) => {
		if (err) {
			console.error('Failed to retrieve user:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		if (!user) {
			return res.status(404).json({ success: false, message: "User not found" });
		}
		if (!canManageTarget(req.user.role, user.role)) {
			return res.status(403).json({ success: false, message: "Only a superadmin can delete an admin or superadmin account" });
		}

		db.get(`SELECT COUNT(*) as count FROM places WHERE ownerId = ?`, [userId], (err, row) => {
			if (err) {
				console.error('Failed to check owned places:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}
			if (row.count > 0) {
				return res.status(409).json({ success: false, message: "This user still owns places. Reassign or delete them first." });
			}

			db.run(`DELETE FROM place_access WHERE userId = ?`, [userId], (err) => {
				if (err) {
					console.error('Failed to delete access grants for user:', err.message);
					return res.status(500).json({ success: false, message: "Internal server error" });
				}

				db.run(`DELETE FROM users WHERE id = ?`, [userId], (err) => {
					if (err) {
						console.error('Failed to delete user:', err.message);
						return res.status(500).json({ success: false, message: "Internal server error" });
					}
					res.json({ success: true });
				});
			});
		});
	});
});
