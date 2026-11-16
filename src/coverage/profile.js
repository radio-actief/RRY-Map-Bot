// Adapted from map.meshcore.io (https://github.com/meshcore-dev/map.meshcore.io), MIT License,
// Copyright (c) 2025 Rastislav Vysoky. See LICENSE in this folder.
// Changed here: the functions work on the state they are given (the panel keeps it, see planning.js).

// Point-to-point profile between two ends, each a node ({ publicKey }) or a picked point ({ lat, lon })
export function createProfileState() {
	return {
		a: null,
		b: null,
		// antenna heights above ground (m)
		heightA: 10,
		heightB: 10,
		loading: false,
		error: '',
	};
}

// Sets the next free end (the start first); with both set, replaces the end
export function addProfileEnd(profile, end) {
	if(!profile.a) profile.a = end;
	else profile.b = end;
	profile.error = '';
}

export function setProfileStart(profile, end) {
	profile.a = end;
	profile.error = '';
}

export function swapProfileEnds(profile) {
	[profile.a, profile.b] = [profile.b, profile.a];
	[profile.heightA, profile.heightB] = [profile.heightB, profile.heightA];
}

export function closeProfile(profile) {
	profile.a = null;
	profile.b = null;
	profile.loading = false;
	profile.error = '';
}

// Both ends at the same place (the same node, or the same point)
export function sameEnds(a, b) {
	if(!a || !b) return false;
	if(a.publicKey || b.publicKey) return a.publicKey === b.publicKey;
	return a.lat === b.lat && a.lon === b.lon;
}
