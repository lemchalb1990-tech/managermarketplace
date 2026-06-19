const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
bcrypt.hash('Admin123!', 10)
  .then(hash => prisma.user.create({
    data: { email: 'admin@marketplace.com', password: hash, name: 'Super Admin', role: 'SUPER_ADMIN' }
  }))
  .then(u => { console.log('Super Admin creado:', u.email); })
  .catch(e => console.error('Error:', e.message))
  .finally(() => prisma.$disconnect());
