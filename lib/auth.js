// Shared permission levels for users.
// 1 = Normal user (default): standard access to their own places/readers.
// 2 = Elevated: same as normal, but bypasses ownership checks (can see/manage all places/readers).
// 3 = Admin: same as elevated, and can also administrate users (create/delete/reset password/change role).
// 4 = Superadmin: same as admin, and can also grant/revoke the admin role itself. Automatically granted
//     to the very first registered user. There is no API path that can create/promote another superadmin;
//     the only way to grant this role is by editing the database directly.
const ROLES = {
	USER: 1,
	ELEVATED: 2,
	ADMIN: 3,
	SUPERADMIN: 4
};

// Returns Express middleware that requires an authenticated session and (optionally) a minimum role.
// `getDb` is a function returning the current db instance, since route modules assign `db` after this
// middleware is registered (see routes/dashboard.js and routes/admin.js).
function requireAuth(getDb, minRole = ROLES.USER) {
	return function (req, res, next) {
		if (!req.session || !req.session.userId) {
			return res.status(401).json({ success: false, message: "Not authenticated" });
		}

		const db = getDb();
		db.get(`SELECT id, username, role FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
			if (err) {
				console.error('Failed to load user:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}

			if (!user) {
				return req.session.destroy(() => {
					res.status(401).json({ success: false, message: "Not authenticated" });
				});
			}

			req.user = user;

			if (user.role < minRole) {
				return res.status(403).json({ success: false, message: "Insufficient permissions" });
			}

			next();
		});
	};
}

module.exports = { ROLES, requireAuth };
