let currentPlaceId = null;
let places = [];

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
	document.getElementById('username-display').textContent = me.user.username;

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

	document.getElementById('no-place').classList.add('hidden');
	document.getElementById('place-view').classList.remove('hidden');
	document.getElementById('place-title').textContent = placeId;

	renderReaders(data.accessPoints || []);
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
				<button class="danger delete-btn">Delete</button>
			</div>
		`;

		card.querySelector('.save-btn').addEventListener('click', () => saveReader(ap.id, card));
		card.querySelector('.delete-btn').addEventListener('click', () => deleteReader(ap.id));
		card.querySelector('.acl-btn').addEventListener('click', () => openAclModal(ap.id, ap.name));

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
	4: 'Allow all'
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
		default:
			return entry.data;
	}
}

function updateAclFormFields() {
	const type = parseInt(document.getElementById('acl-type').value, 10);
	const dataGroup = document.getElementById('acl-data-group');
	const groupIdGroup = document.getElementById('acl-group-id-group');
	const groupRankGroup = document.getElementById('acl-group-rank-group');
	const dataLabel = dataGroup.querySelector('label');
	const dataInput = document.getElementById('acl-data');

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
		if (!groupId || rank === '') return;
		data = `${groupId}:${rank}`;
	} else if (type === 4) {
		data = '*';
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

init();
