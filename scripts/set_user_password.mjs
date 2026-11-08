import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const newPassword = process.argv[2];
const emailArg = process.argv[3] || 'vijaypaij@gmail.com';

if (!newPassword || newPassword.length < 8) {
  console.error('Usage: node scripts/set_user_password.mjs <new_password_min_8_chars> [email]');
  process.exit(1);
}

const usersFile = path.join(process.cwd(), 'data', 'users.json');
if (!fs.existsSync(usersFile)) {
  console.error(`Users file not found at ${usersFile}`);
  process.exit(1);
}

const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
const userIndex = users.findIndex(u => u.email.toLowerCase() === emailArg.toLowerCase() || u.id === 1);

if (userIndex === -1) {
  console.error(`User with email ${emailArg} not found.`);
  process.exit(1);
}

const hash = await bcrypt.hash(newPassword, 12);
users[userIndex].email = emailArg;
users[userIndex].password_hash = hash;
users[userIndex].active_session_id = null;
users[userIndex].updated_at = new Date().toISOString();

fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf-8');
console.log(`Password updated successfully for ${emailArg}!`);
