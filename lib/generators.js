const crypto = require('crypto');

// Characters used when generating a random API key: letters, digits and a handful of symbols.
const API_KEY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
const API_KEY_LENGTH = 64;

// Generates a new place id as a random UUID (v4).
function generatePlaceId() {
	return crypto.randomUUID();
}

// Generates a random alphanumeric+symbol API key of the given length (default 64 characters).
function generateApiKey(length = API_KEY_LENGTH) {
	const bytes = crypto.randomBytes(length);
	let key = '';
	for (let i = 0; i < length; i++) {
		key += API_KEY_CHARS[bytes[i] % API_KEY_CHARS.length];
	}
	return key;
}

module.exports = { generatePlaceId, generateApiKey };
