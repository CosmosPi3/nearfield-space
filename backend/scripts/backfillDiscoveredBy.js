#!/usr/bin/env node
// One-off: attributes every pre-existing track (extracted before the
// "discovered by" feature shipped, so discovered_by_user_id is still NULL)
// to a specific user. Going forward every new track always gets a real
// discoverer stamped atomically at extraction time (see db/index.js's
// upsert), since sign-in is required app-wide — so this is a single
// retroactive fix, not an ongoing migration.
// Usage: node scripts/backfillDiscoveredBy.js <userId>
const db = require('../src/db');

function main() {
  const userId = parseInt(process.argv[2], 10);
  if (!Number.isInteger(userId)) {
    console.error('Usage: node scripts/backfillDiscoveredBy.js <userId>');
    process.exit(1);
  }

  const user = db.getUserById(userId);
  if (!user) {
    console.error(`No user with id ${userId}. Check GET /api/auth/me while logged in, or query the users table directly.`);
    process.exit(1);
  }

  const { changes } = db.backfillDiscoveredBy(userId);
  console.log(`Set discovered_by_user_id=${userId} (${user.display_name}) on ${changes} track(s) that had no discoverer.`);
}

main();
