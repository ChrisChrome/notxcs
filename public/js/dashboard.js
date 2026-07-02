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
				<button class="danger delete-btn">Delete</button>
			</div>
		`;

		card.querySelector('.save-btn').addEventListener('click', () => saveReader(ap.id, card));
		card.querySelector('.delete-btn').addEventListener('click', () => deleteReader(ap.id));

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

init();
