import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Límite de las transacciones interactivas ($transaction(async tx => …)). El de Prisma por
    // defecto (5 s) alcanzaba con la base en el mismo servidor, pero con la base remota
    // (Supabase) cada consulta suma latencia y operaciones largas como unificar productos
    // superaban los 5 s ("Transaction not found") y se deshacían.
    super({ transactionOptions: { maxWait: 10_000, timeout: 60_000 } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
