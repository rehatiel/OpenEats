const bcrypt = require('bcryptjs');

// PIN hashes use bcrypt's per-row random salt, so there is no direct
// `WHERE pin_hash = ?` lookup — every active user's hash must be compared
// against the submitted PIN. Fine for a single-location staff roster (tens
// of people, not thousands); do not "optimize" this into an indexed lookup.
function findUserByPin(db, pin) {
  const users = db.prepare('SELECT id, name, role, pin_hash FROM users WHERE active = 1').all();
  return users.find((u) => bcrypt.compareSync(pin, u.pin_hash)) ?? null;
}

// PIN uniqueness can't be a DB constraint for the same hashing reason, so it
// must be enforced here. Required, not optional: with PIN-only login, two
// active staff sharing a PIN means login authenticates the wrong person.
function pinCollidesWithActiveUser(db, pin, excludeUserId = null) {
  const users = db
    .prepare('SELECT id, pin_hash FROM users WHERE active = 1' + (excludeUserId ? ' AND id != ?' : ''))
    .all(...(excludeUserId ? [excludeUserId] : []));
  return users.some((u) => bcrypt.compareSync(pin, u.pin_hash));
}

module.exports = { findUserByPin, pinCollidesWithActiveUser };
