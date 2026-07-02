let currentUser = null;
let users = [];

const ROLE_LABELS = {
	1: 'User',
	2: 'Elevated',
	3: 'Admin',
	4: 'Superadmin'
};

async function api(path, options = {}) {
	const res = await fetch(path, {
		headers: { 'Content-Type': 'application/json' },
		...options
	});
	const data = await res.json().catch(() => ({ success: false, message: 'Invalid response from server' }));
	if (res.status === 401) {
		window.location.href = '/login';
		throw new Error('Not authenticated');
	}
	return data;
}

function escapeHtml(str) {
	const div = document.createElement('div');
	div.textContent = str;
	return div.innerHTML;
}

async function init() {
	const me = await api('/auth/me');
	if (!me.success) {
		window.location.href = '/login';
		return;
	}
	if (me.user.role < 3) {
		window.location.href = '/dashboard';
		return;
	}
	currentUser = me.user;
	document.getElementById('username-display').textContent = me.user.username;
	document.getElementById('role-badge').textContent = ROLE_LABELS[me.user.role] || 'User';

	// Only a superadmin can grant the admin role; hide that option for regular admins.
	if (currentUser.role < 4) {
		document.querySelector('#new-user-role option[value="3"]').remove();
	}

	await loadUsers();
	await loadLockdownStatus();
}

async function loadLockdownStatus() {
	const data = await api('/admin/lockdown');
	const badge = document.getElementById('lockdown-badge');
	const engageBtn = document.getElementById('engage-lockdown-btn');
	const liftBtn = document.getElementById('lift-lockdown-btn');

	if (!data.success) {
		badge.textContent = 'Unknown';
		return;
	}

	if (data.active) {
		badge.textContent = 'Lockdown active';
		badge.className = 'badge off';
		engageBtn.classList.add('hidden');
		liftBtn.classList.remove('hidden');
	} else {
		badge.textContent = 'Normal operation';
		badge.className = 'badge on';
		engageBtn.classList.remove('hidden');
		liftBtn.classList.add('hidden');
	}
}

document.getElementById('engage-lockdown-btn').addEventListener('click', async () => {
	if (!confirm('Engage site-wide lockdown? This will disable every reader at every place until lifted.')) return;

	const result = await api('/admin/lockdown', { method: 'POST' });
	if (result.success) {
		await loadLockdownStatus();
	} else {
		alert(result.message || 'Failed to engage lockdown');
	}
});

document.getElementById('lift-lockdown-btn').addEventListener('click', async () => {
	const result = await api('/admin/lockdown', { method: 'DELETE' });
	if (result.success) {
		await loadLockdownStatus();
	} else {
		alert(result.message || 'Failed to lift lockdown');
	}
});

async function loadUsers() {
	const data = await api('/admin/users');
	users = data.users || [];
	renderUsersList();
}

function roleOptions(selectedRole) {
	const canGrantAdmin = currentUser.role >= 4;
	const options = [
		{ value: 1, label: 'User' },
		{ value: 2, label: 'Elevated' }
	];
	if (canGrantAdmin || selectedRole === 3) {
		options.push({ value: 3, label: 'Admin' });
	}
	return options.map(o => `<option value="${o.value}" ${o.value === selectedRole ? 'selected' : ''}>${o.label}</option>`).join('');
}

function renderUsersList() {
	const list = document.getElementById('users-list');
	const empty = document.getElementById('users-empty');
	list.innerHTML = '';

	if (users.length === 0) {
		empty.classList.remove('hidden');
		return;
	}
	empty.classList.add('hidden');

	users.forEach((user) => {
		const isSuperadmin = user.role >= 4;
		const canManage = currentUser.role >= 4 || user.role < 3;
		const li = document.createElement('li');
		li.className = 'acl-entry';

		if (isSuperadmin) {
			li.innerHTML = `
				<span class="acl-description">${escapeHtml(user.username)}</span>
				<span class="badge type-badge">Superadmin</span>
			`;
			list.appendChild(li);
			return;
		}

		li.innerHTML = `
			<span class="acl-description">${escapeHtml(user.username)}</span>
			<select class="role-select" ${canManage ? '' : 'disabled'}>${roleOptions(user.role)}</select>
			<input type="password" class="password-input" placeholder="New password" style="margin:0;width:160px;">
			<button class="secondary save-btn" ${canManage ? '' : 'disabled'}>Save</button>
			<button class="danger delete-btn" ${canManage && user.id !== currentUser.id ? '' : 'disabled'}>Delete</button>
		`;

		li.querySelector('.save-btn').addEventListener('click', () => saveUser(user.id, li));
		li.querySelector('.delete-btn').addEventListener('click', () => deleteUser(user.id, user.username));

		list.appendChild(li);
	});
}

async function saveUser(userId, li) {
	const role = parseInt(li.querySelector('.role-select').value, 10);
	const password = li.querySelector('.password-input').value;

	const body = { role };
	if (password) {
		if (password.length < 6) {
			alert('Password must be at least 6 characters');
			return;
		}
		body.password = password;
	}

	const result = await api(`/admin/users/${encodeURIComponent(userId)}`, {
		method: 'PUT',
		body: JSON.stringify(body)
	});

	if (result.success) {
		await loadUsers();
	} else {
		alert(result.message || 'Failed to update user');
	}
}

async function deleteUser(userId, username) {
	if (!confirm(`Delete user "${username}"?`)) return;

	const result = await api(`/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
	if (result.success) {
		await loadUsers();
	} else {
		alert(result.message || 'Failed to delete user');
	}
}

document.getElementById('add-user-form').addEventListener('submit', async (e) => {
	e.preventDefault();

	const username = document.getElementById('new-user-username').value.trim();
	const password = document.getElementById('new-user-password').value;
	const role = parseInt(document.getElementById('new-user-role').value, 10);
	if (!username || !password) return;

	const result = await api('/admin/users', {
		method: 'POST',
		body: JSON.stringify({ username, password, role })
	});

	if (result.success) {
		document.getElementById('add-user-form').reset();
		await loadUsers();
	} else {
		alert(result.message || 'Failed to create user');
	}
});

document.getElementById('logout-btn').addEventListener('click', async () => {
	await api('/auth/logout', { method: 'POST' });
	window.location.href = '/login';
});

init();
