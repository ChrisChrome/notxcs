let currentPlaceId = null;
let places = [];
let accessGroups = [];
let currentUser = null;
let currentPlaceAccessLevel = null;

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
		window.location.href = '/login.html';
		throw new Error('Not authenticated');
	}
	return data;
}

async function init() {
	const me = await api('/auth/me');
	if (!me.success) {
		window.location.href = '/login.html';
		return;
	}
	currentUser = me.user;
	document.getElementById('username-display').textContent = me.user.username;
	document.getElementById('role-badge').textContent = ROLE_LABELS[me.user.role] || 'User';
	document.getElementById('admin-link').classList.toggle('hidden', me.user.role < 3);

	await loadPlaces();
}

async function loadPlaces() {
	const data = await api('/dashboard/places');
	places = data.places || [];
	renderPlaceList();
}

function renderPlaceList() {
	const list = document.getElementById('place-list');
	list.innerHTML = '';

	places.forEach((place) => {
		const li = document.createElement('li');
		li.textContent = place.id;
		li.className = place.id === currentPlaceId ? 'active' : '';
		li.addEventListener('click', () => selectPlace(place.id));
		list.appendChild(li);
	});
}

async function selectPlace(placeId) {
	currentPlaceId = placeId;
	renderPlaceList();

	const data = await api(`/dashboard/places/${encodeURIComponent(placeId)}`);
	if (!data.success) return;

	currentPlaceAccessLevel = data.accessLevel;

	document.getElementById('no-place').classList.add('hidden');
	document.getElementById('place-view').classList.remove('hidden');
	document.getElementById('place-title').textContent = placeId;

	const canManageOwnership = currentPlaceAccessLevel === 'owner' || currentPlaceAccessLevel === 'bypass';
	document.getElementById('delete-place-btn').classList.toggle('hidden', !canManageOwnership);
	document.getElementById('shared-access-card').classList.toggle('hidden', !canManageOwnership);

	renderReaders(data.accessPoints || []);
	await loadAccessGroups();
	if (canManageOwnership) {
		await loadSharedAccess();
	}
}

function renderReaders(accessPoints) {
	const grid = document.getElementById('readers-grid');
	const empty = document.getElementById('readers-empty');
	grid.innerHTML = '';

	if (accessPoints.length === 0) {
		empty.classList.remove('hidden');
		return;
	}
	empty.classList.add('hidden');

	accessPoints.forEach((ap) => {
		const card = document.createElement('div');
		card.className = 'reader-card';
		card.innerHTML = `
			<div class="reader-name">${escapeHtml(ap.name)}</div>
			<div class="reader-id">${escapeHtml(ap.id)}</div>
			<div class="field">
				<span>Enabled</span>
				<input type="checkbox" data-field="enabled" ${ap.enabled ? 'checked' : ''}>
			</div>
			<div class="field">
				<span>Armed</span>
				<input type="checkbox" data-field="armState" ${ap.armState ? 'checked' : ''}>
			</div>
			<div class="field">
				<span>Unlock time (s)</span>
				<input type="number" data-field="unlockTime" value="${ap.unlockTime}" min="0">
			</div>
			<div class="actions">
				<button class="secondary save-btn">Save</button>
				<button class="secondary acl-btn">Manage access</button>
				<button class="secondary logs-btn">View logs</button>
				<button class="danger delete-btn">Delete</button>
			</div>
		`;

		card.querySelector('.save-btn').addEventListener('click', () => saveReader(ap.id, card));
		card.querySelector('.delete-btn').addEventListener('click', () => deleteReader(ap.id));
		card.querySelector('.acl-btn').addEventListener('click', () => openAclModal(ap.id, ap.name));
		card.querySelector('.logs-btn').addEventListener('click', () => openLogsModal(ap.id, ap.name));

		grid.appendChild(card);
	});
}

function escapeHtml(str) {
	const div = document.createElement('div');
	div.textContent = str;
	return div.innerHTML;
}

async function saveReader(readerId, card) {
	const enabled = card.querySelector('[data-field="enabled"]').checked;
	const armState = card.querySelector('[data-field="armState"]').checked ? 1 : 0;
	const unlockTime = parseInt(card.querySelector('[data-field="unlockTime"]').value, 10) || 0;

	await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-points/${encodeURIComponent(readerId)}`, {
		method: 'PUT',
		body: JSON.stringify({ enabled, armState, unlockTime })
	});
	selectPlace(currentPlaceId);
}

async function deleteReader(readerId) {
	if (!confirm(`Delete reader "${readerId}"?`)) return;
	await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-points/${encodeURIComponent(readerId)}`, {
		method: 'DELETE'
	});
	selectPlace(currentPlaceId);
}

document.getElementById('add-place-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	const id = document.getElementById('place-id').value.trim();
	const apiKey = document.getElementById('place-api-key').value.trim();
	if (!id || !apiKey) return;

	const data = await api('/dashboard/places', {
		method: 'POST',
		body: JSON.stringify({ id, apiKey })
	});

	if (data.success) {
		document.getElementById('place-id').value = '';
		document.getElementById('place-api-key').value = '';
		await loadPlaces();
		selectPlace(id);
	} else {
		alert(data.message || 'Failed to add place');
	}
});

document.getElementById('add-reader-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	if (!currentPlaceId) return;

	const id = document.getElementById('reader-id').value.trim();
	const name = document.getElementById('reader-name').value.trim();
	if (!id || !name) return;

	const data = await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-points`, {
		method: 'POST',
		body: JSON.stringify({ id, name })
	});

	if (data.success) {
		document.getElementById('reader-id').value = '';
		document.getElementById('reader-name').value = '';
		selectPlace(currentPlaceId);
	} else {
		alert(data.message || 'Failed to add reader');
	}
});

document.getElementById('delete-place-btn').addEventListener('click', async () => {
	if (!currentPlaceId) return;
	if (!confirm(`Delete place "${currentPlaceId}" and all of its readers?`)) return;

	await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}`, { method: 'DELETE' });
	currentPlaceId = null;
	document.getElementById('place-view').classList.add('hidden');
	document.getElementById('no-place').classList.remove('hidden');
	await loadPlaces();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
	await api('/auth/logout', { method: 'POST' });
	window.location.href = '/login.html';
});

// --- ACL (allowed persons / credentials) management ---

let currentAclReaderId = null;

const ACL_TYPE_LABELS = {
	0: 'User ID',
	1: 'Card number',
	2: 'Group exact rank',
	3: 'Group min rank',
	4: 'Allow all',
	5: 'Access group'
};

function aclEntryDescription(entry) {
	switch (entry.type) {
		case 0:
			return `User ID: ${entry.data}`;
		case 1:
			return `Card number: ${entry.data}`;
		case 2: {
			const [group, rank] = entry.data.split(':');
			return `Group ${group}, exact rank ${rank}`;
		}
		case 3: {
			const [group, rank] = entry.data.split(':');
			return `Group ${group}, rank ${rank}+`;
		}
		case 4:
			return 'Everyone';
		case 5: {
			const group = accessGroups.find(g => String(g.id) === String(entry.data));
			return `Access group: ${group ? group.name : entry.data}`;
		}
		default:
			return entry.data;
	}
}

function updateAclFormFields() {
	const type = parseInt(document.getElementById('acl-type').value, 10);
	const dataGroup = document.getElementById('acl-data-group');
	const groupIdGroup = document.getElementById('acl-group-id-group');
	const groupRankGroup = document.getElementById('acl-group-rank-group');
	const accessGroupGroup = document.getElementById('acl-access-group-group');
	const dataLabel = dataGroup.querySelector('label');
	const dataInput = document.getElementById('acl-data');

	dataGroup.classList.add('hidden');
	groupIdGroup.classList.add('hidden');
	groupRankGroup.classList.add('hidden');
	accessGroupGroup.classList.add('hidden');
	dataInput.required = false;

	if (type === 0) {
		dataLabel.textContent = 'User ID';
		dataGroup.classList.remove('hidden');
		dataInput.required = true;
	} else if (type === 1) {
		dataLabel.textContent = 'Card number';
		dataGroup.classList.remove('hidden');
		dataInput.required = true;
	} else if (type === 2 || type === 3) {
		groupIdGroup.classList.remove('hidden');
		groupRankGroup.classList.remove('hidden');
	} else if (type === 5) {
		accessGroupGroup.classList.remove('hidden');
		populateAccessGroupSelect();
	}
	// type === 4 (Allow all) needs no extra input
}

function populateAccessGroupSelect() {
	const select = document.getElementById('acl-access-group');
	select.innerHTML = '';
	accessGroups.forEach((group) => {
		const option = document.createElement('option');
		option.value = group.id;
		option.textContent = group.name;
		select.appendChild(option);
	});
}

document.getElementById('acl-type').addEventListener('change', updateAclFormFields);
updateAclFormFields();

async function openAclModal(readerId, readerName) {
	currentAclReaderId = readerId;
	document.getElementById('acl-reader-name').textContent = readerName;
	document.getElementById('acl-modal').classList.remove('hidden');
	document.getElementById('add-acl-form').reset();
	updateAclFormFields();
	await loadAcl();
}

function closeAclModal() {
	currentAclReaderId = null;
	document.getElementById('acl-modal').classList.add('hidden');
}

async function loadAcl() {
	if (!currentAclReaderId) return;
	const data = await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-points/${encodeURIComponent(currentAclReaderId)}/acl`);
	renderAclList(data.acl || []);
}

function renderAclList(entries) {
	const list = document.getElementById('acl-list');
	const empty = document.getElementById('acl-empty');
	list.innerHTML = '';

	if (entries.length === 0) {
		empty.classList.remove('hidden');
		return;
	}
	empty.classList.add('hidden');

	entries.forEach((entry) => {
		const li = document.createElement('li');
		li.className = 'acl-entry';
		li.innerHTML = `
			<span class="badge type-badge">${escapeHtml(ACL_TYPE_LABELS[entry.type] || 'Unknown')}</span>
			<span class="acl-description">${escapeHtml(aclEntryDescription(entry))}</span>
			<button class="danger acl-delete-btn">Remove</button>
		`;
		li.querySelector('.acl-delete-btn').addEventListener('click', () => deleteAclEntry(entry.id));
		list.appendChild(li);
	});
}

async function deleteAclEntry(aclId) {
	if (!currentAclReaderId) return;
	if (!confirm('Remove this entry?')) return;

	await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-points/${encodeURIComponent(currentAclReaderId)}/acl/${encodeURIComponent(aclId)}`, {
		method: 'DELETE'
	});
	await loadAcl();
}

document.getElementById('add-acl-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	if (!currentAclReaderId) return;

	const type = parseInt(document.getElementById('acl-type').value, 10);
	let data;

	if (type === 0 || type === 1) {
		data = document.getElementById('acl-data').value.trim();
		if (!data) return;
	} else if (type === 2 || type === 3) {
		const groupId = document.getElementById('acl-group-id').value.trim();
		const rank = document.getElementById('acl-group-rank').value.trim();
		if (!groupId || !rank) return;
		data = `${groupId}:${rank}`;
	} else if (type === 4) {
		data = '*';
	} else if (type === 5) {
		data = document.getElementById('acl-access-group').value;
		if (!data) return;
	}

	const result = await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-points/${encodeURIComponent(currentAclReaderId)}/acl`, {
		method: 'POST',
		body: JSON.stringify({ type, data })
	});

	if (result.success) {
		document.getElementById('add-acl-form').reset();
		updateAclFormFields();
		await loadAcl();
	} else {
		alert(result.message || 'Failed to add entry');
	}
});

document.getElementById('acl-close-btn').addEventListener('click', closeAclModal);
document.getElementById('acl-modal').addEventListener('click', (e) => {
	if (e.target.id === 'acl-modal') closeAclModal();
});

// --- Access groups (bundles of users/cards/rank rules assignable to multiple readers) ---

async function loadAccessGroups() {
	if (!currentPlaceId) return;
	const data = await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-groups`);
	accessGroups = data.groups || [];
	renderAccessGroupsList();
}

function renderAccessGroupsList() {
	const list = document.getElementById('access-groups-list');
	const empty = document.getElementById('access-groups-empty');
	list.innerHTML = '';

	if (accessGroups.length === 0) {
		empty.classList.remove('hidden');
		return;
	}
	empty.classList.add('hidden');

	accessGroups.forEach((group) => {
		const li = document.createElement('li');
		li.className = 'acl-entry';
		li.innerHTML = `
			<span class="badge type-badge">Group</span>
			<span class="acl-description">${escapeHtml(group.name)}</span>
			<button class="secondary group-manage-btn">Manage members</button>
			<button class="danger group-delete-btn">Delete</button>
		`;
		li.querySelector('.group-manage-btn').addEventListener('click', () => openGroupModal(group.id, group.name));
		li.querySelector('.group-delete-btn').addEventListener('click', () => deleteAccessGroup(group.id));
		list.appendChild(li);
	});
}

async function deleteAccessGroup(groupId) {
	if (!confirm('Delete this access group? It will be removed from any readers it was assigned to.')) return;
	await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-groups/${encodeURIComponent(groupId)}`, {
		method: 'DELETE'
	});
	await loadAccessGroups();
}

document.getElementById('add-access-group-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	if (!currentPlaceId) return;

	const name = document.getElementById('access-group-name').value.trim();
	if (!name) return;

	const result = await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-groups`, {
		method: 'POST',
		body: JSON.stringify({ name })
	});

	if (result.success) {
		document.getElementById('access-group-name').value = '';
		await loadAccessGroups();
	} else {
		alert(result.message || 'Failed to add access group');
	}
});

// --- Access group members management ---

let currentGroupId = null;

function updateGroupMemberFormFields() {
	const type = parseInt(document.getElementById('group-member-type').value, 10);
	const dataGroup = document.getElementById('group-member-data-group');
	const groupIdGroup = document.getElementById('group-member-group-id-group');
	const groupRankGroup = document.getElementById('group-member-group-rank-group');
	const dataLabel = dataGroup.querySelector('label');
	const dataInput = document.getElementById('group-member-data');

	dataGroup.classList.add('hidden');
	groupIdGroup.classList.add('hidden');
	groupRankGroup.classList.add('hidden');
	dataInput.required = false;

	if (type === 0) {
		dataLabel.textContent = 'User ID';
		dataGroup.classList.remove('hidden');
		dataInput.required = true;
	} else if (type === 1) {
		dataLabel.textContent = 'Card number';
		dataGroup.classList.remove('hidden');
		dataInput.required = true;
	} else if (type === 2 || type === 3) {
		groupIdGroup.classList.remove('hidden');
		groupRankGroup.classList.remove('hidden');
	}
	// type === 4 (Allow all) needs no extra input
}

document.getElementById('group-member-type').addEventListener('change', updateGroupMemberFormFields);
updateGroupMemberFormFields();

async function openGroupModal(groupId, groupName) {
	currentGroupId = groupId;
	document.getElementById('group-name').textContent = groupName;
	document.getElementById('group-modal').classList.remove('hidden');
	document.getElementById('add-group-member-form').reset();
	updateGroupMemberFormFields();
	await loadGroupMembers();
}

function closeGroupModal() {
	currentGroupId = null;
	document.getElementById('group-modal').classList.add('hidden');
}

async function loadGroupMembers() {
	if (!currentGroupId) return;
	const data = await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-groups/${encodeURIComponent(currentGroupId)}/members`);
	renderGroupMembersList(data.members || []);
}

function renderGroupMembersList(members) {
	const list = document.getElementById('group-members-list');
	const empty = document.getElementById('group-members-empty');
	list.innerHTML = '';

	if (members.length === 0) {
		empty.classList.remove('hidden');
		return;
	}
	empty.classList.add('hidden');

	members.forEach((member) => {
		const li = document.createElement('li');
		li.className = 'acl-entry';
		li.innerHTML = `
			<span class="badge type-badge">${escapeHtml(ACL_TYPE_LABELS[member.type] || 'Unknown')}</span>
			<span class="acl-description">${escapeHtml(aclEntryDescription(member))}</span>
			<button class="danger group-member-delete-btn">Remove</button>
		`;
		li.querySelector('.group-member-delete-btn').addEventListener('click', () => deleteGroupMember(member.id));
		list.appendChild(li);
	});
}

async function deleteGroupMember(memberId) {
	if (!currentGroupId) return;
	if (!confirm('Remove this member?')) return;

	await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-groups/${encodeURIComponent(currentGroupId)}/members/${encodeURIComponent(memberId)}`, {
		method: 'DELETE'
	});
	await loadGroupMembers();
}

document.getElementById('add-group-member-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	if (!currentGroupId) return;

	const type = parseInt(document.getElementById('group-member-type').value, 10);
	let data;

	if (type === 0 || type === 1) {
		data = document.getElementById('group-member-data').value.trim();
		if (!data) return;
	} else if (type === 2 || type === 3) {
		const groupId = document.getElementById('group-member-group-id').value.trim();
		const rank = document.getElementById('group-member-group-rank').value.trim();
		if (!groupId || !rank) return;
		data = `${groupId}:${rank}`;
	} else if (type === 4) {
		data = '*';
	}

	const result = await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-groups/${encodeURIComponent(currentGroupId)}/members`, {
		method: 'POST',
		body: JSON.stringify({ type, data })
	});

	if (result.success) {
		document.getElementById('add-group-member-form').reset();
		updateGroupMemberFormFields();
		await loadGroupMembers();
	} else {
		alert(result.message || 'Failed to add member');
	}
});

document.getElementById('group-close-btn').addEventListener('click', closeGroupModal);
document.getElementById('group-modal').addEventListener('click', (e) => {
	if (e.target.id === 'group-modal') closeGroupModal();
});

// --- Scan logs viewing ---

let currentLogsReaderId = null;

async function openLogsModal(readerId, readerName) {
	currentLogsReaderId = readerId;
	document.getElementById('logs-reader-name').textContent = readerName;
	document.getElementById('logs-modal').classList.remove('hidden');
	await loadLogs();
}

function closeLogsModal() {
	currentLogsReaderId = null;
	document.getElementById('logs-modal').classList.add('hidden');
}

async function loadLogs() {
	if (!currentLogsReaderId) return;
	const data = await api(`/dashboard/places/${encodeURIComponent(currentPlaceId)}/access-points/${encodeURIComponent(currentLogsReaderId)}/logs`);
	renderLogsList(data.logs || []);
}

function renderLogsList(logs) {
	const list = document.getElementById('logs-list');
	const empty = document.getElementById('logs-empty');
	list.innerHTML = '';

	if (logs.length === 0) {
		empty.classList.remove('hidden');
		return;
	}
	empty.classList.add('hidden');

	logs.forEach((log) => {
		const li = document.createElement('li');
		li.className = 'acl-entry';
		const granted = !!log.granted;
		const cards = log.cardNumbers ? `, cards: ${escapeHtml(log.cardNumbers)}` : '';
		li.innerHTML = `
			<span class="badge type-badge" style="background:${granted ? 'var(--success)' : 'var(--danger)'};">${granted ? 'Granted' : 'Denied'}</span>
			<span class="acl-description">${escapeHtml(log.scannedAt)} — user: ${escapeHtml(log.userId || 'unknown')}${cards}</span>
		`;
		list.appendChild(li);
	});
}

document.getElementById('logs-close-btn').addEventListener('click', closeLogsModal);
document.getElementById('logs-modal').addEventListener('click', (e) => {
	if (e.target.id === 'logs-modal') closeLogsModal();
});

init();
