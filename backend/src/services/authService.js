const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const { AppError } = require('../utils/errors');
const { GOOGLE_CLIENT_ID } = require('../config');

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleIdToken(idToken) {
  if (!idToken) throw new AppError('BAD_REQUEST', 'idToken is required');
  let ticket;
  try {
    ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  } catch (err) {
    throw new AppError('BAD_REQUEST', 'Invalid Google ID token', { cause: err });
  }
  return ticket.getPayload();
}

// Public-facing name only, deliberately not the full legal name: "{given
// name} {family name initial}." (e.g. "Sarah K."), disambiguated with a
// numeric suffix on collision. Computed once at signup and stored permanently
// -- it's what the library's "discovered by" credit and any future
// leaderboard will show.
function buildDisplayName({ givenName, familyName }) {
  const base = familyName ? `${givenName} ${familyName.charAt(0)}.` : givenName;
  if (!db.isDisplayNameTaken(base)) return base;
  let suffix = 2;
  while (db.isDisplayNameTaken(`${base} (${suffix})`)) suffix += 1;
  return `${base} (${suffix})`;
}

function findOrCreateUser({ sub, email, given_name: givenName, family_name: familyName, picture }) {
  const existing = db.getUserByGoogleSub(sub);
  if (existing) return existing;
  return db.insertUser({
    googleSub: sub,
    email: email || null,
    givenName: givenName || null,
    familyName: familyName || null,
    displayName: buildDisplayName({ givenName: givenName || 'User', familyName }),
    avatarUrl: picture || null,
  });
}

const MIN_DISPLAY_NAME_LENGTH = 2;
const MAX_DISPLAY_NAME_LENGTH = 50;
// Letters (Unicode-aware — accented names are fine), numbers, spaces, and
// just enough punctuation to cover real names (O'Brien, Jean-Luc) and this
// app's own auto-generated "{given} {initial}. (2)" collision format.
const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N} .'()-]+$/u;

// User-initiated rename, distinct from buildDisplayName's auto-suffix-on-
// collision behavior above — here a taken name is a hard error (the user
// picked it on purpose), not something to silently disambiguate for them.
function updateDisplayName(userId, rawDisplayName) {
  const displayName = (rawDisplayName || '').trim();
  if (!displayName) throw new AppError('BAD_REQUEST', 'Display name is required');
  if (displayName.length < MIN_DISPLAY_NAME_LENGTH) {
    throw new AppError('BAD_REQUEST', `Display name must be at least ${MIN_DISPLAY_NAME_LENGTH} characters`);
  }
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new AppError('BAD_REQUEST', `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`);
  }
  if (!DISPLAY_NAME_PATTERN.test(displayName)) {
    throw new AppError('BAD_REQUEST', "Display name can only contain letters, numbers, spaces, and . ' - ( )");
  }
  const existing = db.getUserById(userId);
  if (displayName !== existing.display_name && db.isDisplayNameTaken(displayName)) {
    throw new AppError('BAD_REQUEST', 'That display name is already taken');
  }
  db.updateDisplayName(userId, displayName);
  return db.getUserById(userId);
}

function createSessionForUser(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.createSession(token, userId);
  return token;
}

function getUserForToken(token) {
  return db.getSessionUser(token);
}

function logout(token) {
  db.deleteSession(token);
}

function toPublicUser(user) {
  return { id: user.id, displayName: user.display_name, avatarUrl: user.avatar_url };
}

module.exports = { verifyGoogleIdToken, findOrCreateUser, updateDisplayName, createSessionForUser, getUserForToken, logout, toPublicUser };
