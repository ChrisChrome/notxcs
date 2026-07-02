document.getElementById('login-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	const errorEl = document.getElementById('error');
	errorEl.classList.remove('visible');

	const username = document.getElementById('username').value.trim();
	const password = document.getElementById('password').value;

	try {
		const res = await fetch('/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password })
		});
		const data = await res.json();

		if (!data.success) {
			errorEl.textContent = data.message || 'Login failed';
			errorEl.classList.add('visible');
			return;
		}

		window.location.href = '/dashboard';
	} catch (err) {
		errorEl.textContent = 'Unable to reach the server. Please try again.';
		errorEl.classList.add('visible');
	}
});
