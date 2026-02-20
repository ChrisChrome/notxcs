require('dotenv').config({ quiet: true });
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = process.env.PORT || 3000;

const db = new sqlite3.Database('./database.db', (err) => {
	if (err) {
		console.error('Failed to connect to the database:', err.message);
	} else {
		console.log('Connected to the SQLite database.');
		require('./migrations')(db).then(() => {
			app.listen(port, () => {
				console.log(`NOTXCS API is running on port ${port}`);
			});
		}).catch(err => {
			console.error('Failed to run migrations:', err.message);
		});
	};
});

global.db = db;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
	console.log(`${req.method} ${req.originalUrl}`);
	next();
});

// Load routes dynamically
const fs = require('fs');
const path = require('path');

const routesPath = path.join(__dirname, 'routes');

function loadRoutes(dir, basePath = '/') {
	const files = fs.readdirSync(dir);

	files.forEach((file) => {
		const fullPath = path.join(dir, file);
		const stat = fs.statSync(fullPath);

		if (stat.isDirectory()) {
			loadRoutes(fullPath, path.join(basePath, file));
		} else if (file.endsWith('.js')) {
			const routeName = path.basename(file, '.js');
			const routeUrl = path.join(basePath, routeName === 'index' ? '' : routeName).replace(/\\/g, '/');
			
			try {
				const route = require(fullPath);
				// If the module exports a router/function, use it
				if (typeof route === 'function' || route.name === 'router') {
					app.use(routeUrl, route);
					console.log(`Loaded route: ${routeUrl}`);
				}
			} catch (err) {
				console.error(`Error loading route ${fullPath}:`, err);
			}
		}
	});
}

loadRoutes(routesPath);