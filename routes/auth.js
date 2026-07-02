const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

let db;

module.exports = (dbInit) => {
	db = dbInit;
	return router;
};

router.post('/register', (req, res) => {
	const { username, password } = req.body || {};

	if (!username || !password) {
		return res.status(400).json({ success: false, message: "Username and password are required" });
	}

	if (typeof username !== 'string' || typeof password !== 'string' || username.trim().length < 3 || password.length < 6) {
		return res.status(400).json({ success: false, message: "Username must be at least 3 characters and password at least 6 characters" });
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

			db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hash], function (err) {
				if (err) {
					console.error('Failed to create user:', err.message);
					return res.status(500).json({ success: false, message: "Internal server error" });
				}

				req.session.userId = this.lastID;
				req.session.username = username;
				res.json({ success: true, user: { id: this.lastID, username } });
			});
		});
	});
});

router.post('/login', (req, res) => {
	const { username, password } = req.body || {};

	if (!username || !password) {
		return res.status(400).json({ success: false, message: "Username and password are required" });
	}

	db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
		if (err) {
			console.error('Failed to retrieve user:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}

		if (!user) {
			return res.status(401).json({ success: false, message: "Invalid username or password" });
		}

		bcrypt.compare(password, user.password, (err, matches) => {
			if (err) {
				console.error('Failed to verify password:', err.message);
				return res.status(500).json({ success: false, message: "Internal server error" });
			}

			if (!matches) {
				return res.status(401).json({ success: false, message: "Invalid username or password" });
			}

			req.session.userId = user.id;
			req.session.username = user.username;
			res.json({ success: true, user: { id: user.id, username: user.username } });
		});
	});
});

router.post('/logout', (req, res) => {
	req.session.destroy((err) => {
		if (err) {
			console.error('Failed to destroy session:', err.message);
			return res.status(500).json({ success: false, message: "Internal server error" });
		}
		res.clearCookie('connect.sid');
		res.json({ success: true });
	});
});

router.get('/me', (req, res) => {
	if (!req.session.userId) {
		return res.status(401).json({ success: false, message: "Not authenticated" });
	}
	res.json({ success: true, user: { id: req.session.userId, username: req.session.username } });
});

