import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FinanceAccountType, FinanceBankTxStatus, Prisma, Role } from '@prisma/client';
import { createHash } from 'crypto';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from './finance.service';
import { BankAccountDto, ImportStatementDto, ReconcileDto, TransferDto } from './dto/finance.dto';

const round2 = (n: number) => Math.round(n * 100) / 100;
const gross = (m: { amount: any; tax: any }) => round2(Number(m.amount) + Number(m.tax ?? 0));
const DAY = 24 * 60 * 60 * 1000;

// Bancos, caja, tarjetas y billeteras: saldo, traspasos, cartolas y conciliación.
//
// Saldo de una cuenta = saldo inicial + líneas de cartola importadas + movimientos y traspasos
// que todavía NO están conciliados con una línea (cuando se concilian, cuenta la línea y no se
// suma dos veces). Así el saldo sirve tanto si se importan cartolas como si solo se registran
// movimientos a mano.
@Injectable()
export class FinanceBanksService {
  constructor(private prisma: PrismaService, private finance: FinanceService) {}

  private async getOwnedBank(user: any, id: string) {
    const bank = await this.prisma.financeBankAccount.findUnique({ where: { id } });
    if (!bank) throw new NotFoundException('Cuenta bancaria no encontrada');
    if (user.role !== Role.SUPER_ADMIN && bank.companyId !== user.companyId) throw new ForbiddenException();
    return bank;
  }

  async balanceOf(bank: { id: string; initialBalance: any; initialDate: Date }): Promise<number> {
    const since = { gte: bank.initialDate };
    const [lines, movements, transfersIn, transfersOut] = await Promise.all([
      this.prisma.financeBankTransaction.aggregate({ where: { bankAccountId: bank.id, date: since }, _sum: { amount: true } }),
      this.prisma.financeMovement.findMany({
        where: { bankAccountId: bank.id, date: since, bankTransaction: null },
        select: { amount: true, tax: true, account: { select: { type: true } } },
      }),
      this.prisma.financeTransfer.findMany({
        where: { toAccountId: bank.id, date: since, bankTransactions: { none: { bankAccountId: bank.id } } },
        select: { amount: true },
      }),
      this.prisma.financeTransfer.findMany({
        where: { fromAccountId: bank.id, date: since, bankTransactions: { none: { bankAccountId: bank.id } } },
        select: { amount: true },
      }),
    ]);
    let balance = Number(bank.initialBalance) + Number(lines._sum.amount ?? 0);
    for (const m of movements) balance += (m.account.type === FinanceAccountType.INCOME ? 1 : -1) * gross(m);
    for (const t of transfersIn) balance += Number(t.amount);
    for (const t of transfersOut) balance -= Number(t.amount);
    return round2(balance);
  }

  async listBankAccounts(user: any, companyIdParam?: string) {
    const companyId = this.finance.resolveCompanyId(user, companyIdParam);
    const banks = await this.prisma.financeBankAccount.findMany({ where: { companyId }, orderBy: [{ archived: 'asc' }, { name: 'asc' }] });
    return Promise.all(banks.map(async (b) => {
      const [balance, pending, lastLine] = await Promise.all([
        this.balanceOf(b),
        this.prisma.financeBankTransaction.count({ where: { bankAccountId: b.id, status: FinanceBankTxStatus.PENDING } }),
        this.prisma.financeBankTransaction.findFirst({ where: { bankAccountId: b.id }, orderBy: { date: 'desc' }, select: { date: true, balance: true } }),
      ]);
      return { ...b, balance, pendingCount: pending, lastStatementDate: lastLine?.date ?? null, lastStatementBalance: lastLine?.balance ?? null };
    }));
  }

  async createBankAccount(user: any, dto: BankAccountDto) {
    const companyId = this.finance.resolveCompanyId(user, dto.companyId);
    return this.prisma.financeBankAccount.create({
      data: {
        companyId, name: dto.name.trim(), type: dto.type, bankName: dto.bankName?.trim() || null,
        accountNumber: dto.accountNumber?.trim() || null, initialBalance: dto.initialBalance ?? 0,
        initialDate: dto.initialDate ? this.finance.toStoredDate(dto.initialDate) : new Date(),
      },
    });
  }

  async updateBankAccount(user: any, id: string, dto: BankAccountDto) {
    await this.getOwnedBank(user, id);
    return this.prisma.financeBankAccount.update({
      where: { id },
      data: {
        name: dto.name?.trim(), type: dto.type, bankName: dto.bankName?.trim() || null, accountNumber: dto.accountNumber?.trim() || null,
        initialBalance: dto.initialBalance, archived: dto.archived,
        ...(dto.initialDate ? { initialDate: this.finance.toStoredDate(dto.initialDate) } : {}),
      },
    });
  }

  async deleteBankAccount(user: any, id: string) {
    await this.getOwnedBank(user, id);
    const [movements, transfers, recurrings] = await Promise.all([
      this.prisma.financeMovement.count({ where: { bankAccountId: id } }),
      this.prisma.financeTransfer.count({ where: { OR: [{ fromAccountId: id }, { toAccountId: id }] } }),
      this.prisma.financeRecurring.count({ where: { bankAccountId: id } }),
    ]);
    if (movements || transfers || recurrings) {
      throw new BadRequestException('La cuenta tiene movimientos, traspasos o recurrentes asociados: archívala en vez de eliminarla');
    }
    await this.prisma.financeBankAccount.delete({ where: { id } }); // borra también sus líneas de cartola
    return { deleted: true };
  }

  // ─── Traspasos ───────────────────────────────────────────────────────────────

  async listTransfers(user: any, companyIdParam?: string) {
    const companyId = this.finance.resolveCompanyId(user, companyIdParam);
    return this.prisma.financeTransfer.findMany({
      where: { companyId },
      include: { fromAccount: { select: { id: true, name: true } }, toAccount: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  async createTransfer(user: any, dto: TransferDto) {
    const companyId = this.finance.resolveCompanyId(user, dto.companyId);
    if (dto.fromAccountId === dto.toAccountId) throw new BadRequestException('El origen y el destino deben ser distintos');
    await this.finance.validateBankAccount(companyId, dto.fromAccountId);
    await this.finance.validateBankAccount(companyId, dto.toAccountId);
    return this.prisma.financeTransfer.create({
      data: {
        companyId, fromAccountId: dto.fromAccountId, toAccountId: dto.toAccountId, amount: dto.amount,
        date: this.finance.toStoredDate(dto.date), description: dto.description?.trim() || null, userId: user.id ?? null,
      },
    });
  }

  async deleteTransfer(user: any, id: string) {
    const t = await this.prisma.financeTransfer.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Traspaso no encontrado');
    if (user.role !== Role.SUPER_ADMIN && t.companyId !== user.companyId) throw new ForbiddenException();
    await this.prisma.$transaction(async (tx) => {
      await tx.financeBankTransaction.updateMany({ where: { transferId: id }, data: { status: FinanceBankTxStatus.PENDING, transferId: null } });
      await tx.financeTransfer.delete({ where: { id } });
    });
    return { deleted: true };
  }

  // ─── Cartolas ────────────────────────────────────────────────────────────────

  // Devuelve la tabla cruda del archivo (xlsx o csv): el usuario elige en pantalla qué
  // columna es la fecha, la descripción y los montos, porque cada banco arma su cartola distinto.
  async parseStatement(user: any, id: string, file: Express.Multer.File) {
    await this.getOwnedBank(user, id);
    if (!file) throw new BadRequestException('Falta el archivo');
    const name = (file.originalname || '').toLowerCase();
    let rows: string[][] = [];
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      const text = file.buffer.toString('utf8').replace(/^﻿/, '');
      const firstLine = text.split(/\r?\n/)[0] || '';
      const delimiter = [';', '\t', ','].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
      rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => this.splitCsvLine(l, delimiter));
    } else if (name.endsWith('.xlsx')) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.buffer as any);
      const ws = wb.worksheets[0];
      ws?.eachRow({ includeEmpty: false }, (row) => {
        const values = (row.values as any[]).slice(1).map((v) => this.cellText(v));
        if (values.some((v) => v)) rows.push(values);
      });
    } else {
      throw new BadRequestException('Formato no soportado: sube la cartola como .xlsx o .csv (si es .xls, ábrela y guárdala como .xlsx)');
    }
    return { rows: rows.slice(0, 1000), totalRows: rows.length };
  }

  private splitCsvLine(line: string, d: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
      else if (c === d && !quoted) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  }

  private cellText(v: any): string {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
      if (v.result !== undefined) return this.cellText(v.result);
      if (v.richText) return v.richText.map((r: any) => r.text).join('');
      if (v.text) return String(v.text);
    }
    return String(v).trim();
  }

  async importStatement(user: any, id: string, dto: ImportStatementDto) {
    const bank = await this.getOwnedBank(user, id);
    if (!dto.lines.length) throw new BadRequestException('La cartola no tiene líneas');
    const data = dto.lines.map((l) => {
      const date = this.finance.toStoredDate(l.date);
      const description = (l.description || '').trim() || '(sin descripción)';
      const fingerprint = createHash('sha1')
        .update([date.toISOString().slice(0, 10), round2(l.amount), description.toLowerCase(), l.reference || '', l.balance ?? ''].join('|'))
        .digest('hex');
      return {
        companyId: bank.companyId, bankAccountId: bank.id, date, description, amount: round2(l.amount),
        reference: l.reference?.trim() || null, balance: l.balance ?? null, fingerprint,
      };
    });
    const res = await this.prisma.financeBankTransaction.createMany({ data, skipDuplicates: true });
    const matched = await this.autoMatch(bank.id);
    return { imported: res.count, duplicates: data.length - res.count, autoMatched: matched };
  }

  async listTransactions(user: any, id: string, q: { status?: string; from?: string; to?: string; page?: string }) {
    await this.getOwnedBank(user, id);
    const where: Prisma.FinanceBankTransactionWhereInput = { bankAccountId: id };
    if (q.status && q.status in FinanceBankTxStatus) where.status = q.status as FinanceBankTxStatus;
    if (q.from || q.to) {
      where.date = {};
      if (q.from) where.date.gte = new Date(`${q.from.slice(0, 10)}T00:00:00.000Z`);
      if (q.to) where.date.lte = new Date(`${q.to.slice(0, 10)}T23:59:59.999Z`);
    }
    const PAGE_SIZE = 50;
    const page = Math.max(1, Number(q.page) || 1);
    const [items, total] = await Promise.all([
      this.prisma.financeBankTransaction.findMany({
        where,
        include: {
          movement: { select: { id: true, description: true, amount: true, tax: true, date: true, account: { select: { name: true, type: true } } } },
          transfer: { select: { id: true, amount: true, date: true, description: true, fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.financeBankTransaction.count({ where }),
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  }

  private async getOwnedLine(user: any, lineId: string) {
    const line = await this.prisma.financeBankTransaction.findUnique({ where: { id: lineId } });
    if (!line) throw new NotFoundException('Línea de cartola no encontrada');
    if (user.role !== Role.SUPER_ADMIN && line.companyId !== user.companyId) throw new ForbiddenException();
    return line;
  }

  // Movimientos y traspasos que podrían corresponder a una línea: mismo monto (con IVA) y signo,
  // hasta 10 días de diferencia, todavía sin conciliar.
  async candidates(user: any, lineId: string) {
    const line = await this.getOwnedLine(user, lineId);
    return this.findCandidates(line, 10);
  }

  private async findCandidates(line: { companyId: string; bankAccountId: string; date: Date; amount: any }, days: number) {
    const amount = Number(line.amount);
    const range = { gte: new Date(line.date.getTime() - days * DAY), lte: new Date(line.date.getTime() + days * DAY) };
    const type = amount >= 0 ? FinanceAccountType.INCOME : FinanceAccountType.EXPENSE;
    const [movements, transfers] = await Promise.all([
      this.prisma.financeMovement.findMany({
        where: {
          companyId: line.companyId, date: range, bankTransaction: null, account: { type },
          OR: [{ bankAccountId: line.bankAccountId }, { bankAccountId: null }],
        },
        include: { account: { select: { name: true, type: true } } },
      }),
      this.prisma.financeTransfer.findMany({
        where: {
          companyId: line.companyId, date: range, amount: Math.abs(amount),
          ...(amount >= 0 ? { toAccountId: line.bankAccountId } : { fromAccountId: line.bankAccountId }),
          bankTransactions: { none: { bankAccountId: line.bankAccountId } },
        },
        include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } },
      }),
    ]);
    const byCloseness = (d: Date) => Math.abs(d.getTime() - line.date.getTime());
    return {
      movements: movements.filter((m) => Math.abs(gross(m) - Math.abs(amount)) < 1).sort((a, b) => byCloseness(a.date) - byCloseness(b.date)),
      transfers: transfers.sort((a, b) => byCloseness(a.date) - byCloseness(b.date)),
    };
  }

  // Concilia sola cada línea pendiente que tiene exactamente un candidato (±5 días).
  async autoMatch(bankAccountId: string): Promise<number> {
    const pending = await this.prisma.financeBankTransaction.findMany({ where: { bankAccountId, status: FinanceBankTxStatus.PENDING } });
    let matched = 0;
    const used = new Set<string>();
    for (const line of pending) {
      const { movements, transfers } = await this.findCandidates(line, 5);
      const free = movements.filter((m) => !used.has(m.id));
      const freeTransfers = transfers.filter((t) => !used.has(t.id));
      if (free.length + freeTransfers.length !== 1) continue;
      if (free.length) {
        used.add(free[0].id);
        await this.prisma.$transaction([
          this.prisma.financeBankTransaction.update({ where: { id: line.id }, data: { status: FinanceBankTxStatus.MATCHED, movementId: free[0].id } }),
          this.prisma.financeMovement.update({ where: { id: free[0].id }, data: { bankAccountId } }),
        ]);
      } else {
        used.add(freeTransfers[0].id);
        await this.prisma.financeBankTransaction.update({ where: { id: line.id }, data: { status: FinanceBankTxStatus.MATCHED, transferId: freeTransfers[0].id } });
      }
      matched++;
    }
    return matched;
  }

  async autoMatchForUser(user: any, id: string) {
    await this.getOwnedBank(user, id);
    return { matched: await this.autoMatch(id) };
  }

  async reconcile(user: any, lineId: string, dto: ReconcileDto) {
    const line = await this.getOwnedLine(user, lineId);
    const amount = Number(line.amount);

    if (dto.action === 'unmatch') {
      return this.prisma.financeBankTransaction.update({
        where: { id: line.id }, data: { status: FinanceBankTxStatus.PENDING, movementId: null, transferId: null, note: null },
      });
    }
    if (line.status !== FinanceBankTxStatus.PENDING) throw new BadRequestException('La línea ya está conciliada: deshazla primero');

    if (dto.action === 'ignore') {
      return this.prisma.financeBankTransaction.update({
        where: { id: line.id }, data: { status: FinanceBankTxStatus.IGNORED, note: dto.note?.trim() || null },
      });
    }

    if (dto.action === 'match') {
      if (dto.transferId) {
        const t = await this.prisma.financeTransfer.findUnique({ where: { id: dto.transferId } });
        if (!t || t.companyId !== line.companyId) throw new BadRequestException('Traspaso inválido');
        if (t.fromAccountId !== line.bankAccountId && t.toAccountId !== line.bankAccountId) {
          throw new BadRequestException('El traspaso no involucra esta cuenta');
        }
        return this.prisma.financeBankTransaction.update({ where: { id: line.id }, data: { status: FinanceBankTxStatus.MATCHED, transferId: t.id } });
      }
      if (!dto.movementId) throw new BadRequestException('Elige el movimiento a conciliar');
      const m = await this.prisma.financeMovement.findUnique({ where: { id: dto.movementId }, include: { bankTransaction: true, account: true } });
      if (!m || m.companyId !== line.companyId) throw new BadRequestException('Movimiento inválido');
      if (m.bankTransaction) throw new BadRequestException('Ese movimiento ya está conciliado con otra línea');
      if ((m.account.type === FinanceAccountType.INCOME) !== (amount >= 0)) {
        throw new BadRequestException(amount >= 0 ? 'Un abono se concilia con un ingreso' : 'Un cargo se concilia con un gasto');
      }
      await this.prisma.$transaction([
        this.prisma.financeBankTransaction.update({ where: { id: line.id }, data: { status: FinanceBankTxStatus.MATCHED, movementId: m.id } }),
        this.prisma.financeMovement.update({ where: { id: m.id }, data: { bankAccountId: line.bankAccountId } }),
      ]);
      return { matched: true };
    }

    // create: registra el movimiento a partir de la línea (neto + IVA si corresponde).
    if (!dto.accountId) throw new BadRequestException('Elige la cuenta del movimiento');
    const account = await this.finance.validateMovementAccount(line.companyId, dto.accountId);
    if ((account.type === FinanceAccountType.INCOME) !== (amount >= 0)) {
      throw new BadRequestException(amount >= 0 ? 'Un abono se registra en una cuenta de ingresos' : 'Un cargo se registra en una cuenta de gastos');
    }
    if (account.systemKey) throw new BadRequestException('Esa cuenta se calcula sola: marca la línea como "ya contabilizada" en vez de crear un movimiento');
    const total = Math.abs(amount);
    const net = dto.withIva ? Math.round(total / 1.19) : total;
    return this.prisma.$transaction(async (tx) => {
      const movement = await tx.financeMovement.create({
        data: {
          companyId: line.companyId, accountId: account.id, date: line.date, amount: net, tax: round2(total - net),
          description: dto.description?.trim() || line.description, reference: line.reference, bankAccountId: line.bankAccountId,
          userId: user.id ?? null,
        },
      });
      await tx.financeBankTransaction.update({ where: { id: line.id }, data: { status: FinanceBankTxStatus.MATCHED, movementId: movement.id } });
      return movement;
    });
  }
}
