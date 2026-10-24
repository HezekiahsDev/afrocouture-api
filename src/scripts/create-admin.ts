/**
 * Creates an admin account, or promotes an existing account to admin.
 *
 *   pnpm admin:create <email> <password> "<Full Name>"
 */
import bcrypt from 'bcrypt';
import dataSource from '../database/data-source.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../types/index.js';

const [rawEmail, password, fullName = 'AfroCouture Admin'] = process.argv.slice(2);
const email = rawEmail?.toLowerCase().trim();

if (!email || !password) {
  console.error('Usage: pnpm admin:create <email> <password> "<Full Name>"');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Admin passwords must be at least 12 characters.');
  process.exit(1);
}

await dataSource.initialize();
try {
  const users = dataSource.getRepository(User);
  const user = (await users.findOne({ where: { email } })) ?? users.create({ email });
  user.fullName = user.fullName ?? fullName;
  user.role = UserRole.ADMIN;
  user.emailVerified = true;
  user.pathChosenAt ??= new Date();
  user.status = 'active';
  user.passwordHash = await bcrypt.hash(password, 12);
  await users.save(user);
  console.log(`Admin ready: ${email}`);
} finally {
  await dataSource.destroy();
}
