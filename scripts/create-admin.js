// Creates the first administrator account for a new environment.
//   node scripts/create-admin.js "Username" "a password of at least 8 characters"
// Reads SUPABASE_URL and SUPABASE_SERVICE_KEY from .env. Afterwards sign in and add everyone else on Settings > Accounts.
require('dotenv').config({ quiet: true })
const auth = require('../lib/auth')

const [username, password] = process.argv.slice(2)
if (!username || !password) { console.error('Usage: node scripts/create-admin.js "Username" "password"'); process.exit(1) }
if (String(password).length < 8) { console.error('The password must be at least 8 characters.'); process.exit(1) }

auth.addUser(username, password, 'admin')
  .then(() => { console.log(`Administrator "${username}" created.`); process.exit(0) })
  .catch((e) => { console.error(e.message); process.exit(1) })
