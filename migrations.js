const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const colors = require('colors');

module.exports = (db) => {
    const run = util.promisify(db.run.bind(db));
    const get = util.promisify(db.get.bind(db));
    const exec = util.promisify(db.exec.bind(db));
    return new Promise((resolve, reject) => {
        (async () => {
            try {
                await run(`CREATE TABLE IF NOT EXISTS migrations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );`);

                const migrationsDir = path.join(__dirname, 'migrations');
                let files;
                try {
                    files = await fs.readdir(migrationsDir);
                } catch (e) {
                    if (e.code === 'ENOENT') return resolve(); // no migrations directory
                    throw e;
                }

                files = files.filter(f => path.extname(f).toLowerCase() === '.sql').sort();

                for (const file of files) {
                    const name = file;
                    const already = await get('SELECT 1 FROM migrations WHERE name = ?', [name]);
                    if (already) continue;

                    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');

                    await exec('BEGIN');
                    try {
                        await exec(sql);
                        console.log(`${colors.yellow('[MIGRATION]')} Applied migration: ${name}`);
                        await run('INSERT INTO migrations (name) VALUES (?)', [name]);
                        await exec('COMMIT');
                    } catch (e) {
                        console.error(`${colors.red('[MIGRATION]')} Failed migration: ${name}`);
                        await exec('ROLLBACK');
                        throw e;
                    }
                }
                console.log(`${colors.green('[MIGRATION]')} All migrations applied.`);
                resolve();
            } catch (err) {
                reject(err);
            }
        })();
    });
}