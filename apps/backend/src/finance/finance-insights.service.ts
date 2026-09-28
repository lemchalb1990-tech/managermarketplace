import { Injectable } from '@nestjs/common';
import { FinanceBankTxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { dateKeyStringInTz } from '../common/timezone';
import { FinanceService } from './finance.service';
import { FinanceBanksService } from './finance-banks.service';
import { FinanceRecurringService } from './finance-recurring.service';

type Alert = { level: 'danger' | 'warning' | 'info'; text: string };
const round2 = (n: number) => Math.round(n * 100) / 100;

// Resumen del mes con alertas (para el inicio y la cabecera de Finanzas) y flujo de caja proyectado.
@Injectable()
export class FinanceInsightsService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private finance: FinanceService,
    private banks: FinanceBanksService,
    private recurring: FinanceRecurringService,
  ) {}

  private async currentMonth() {
    const today = dateKeyStringInTz(new Date(), await this.settings.getTimezone());
    const [year, month] = today.split('-').map(Number);
    return { today, year, month };
  }

  async summary(user: any, companyIdParam?: string) {
    const companyId = this.finance.resolveCompanyId(user, companyIdParam);
    await this.recurring.generateDue(companyId);
    const { year, month } = await this.currentMonth();
    const [report, bankAccounts, upcoming] = await Promise.all([
      this.finance.report(user, companyId, year),
      this.banks.listBankAccounts(user, companyId),
      this.recurring.upcoming(companyId, 7),
    ]);
    const i = month - 1;
    const t = report.totals;
    const alerts: Alert[] = [];

    // Gastos sobre (o cerca de) su presupuesto del mes.
    const expenseLeaves = report.accounts.filter((a: any) => a.type === 'EXPENSE' && a.isLeaf && a.budget[i] > 0);
    const over = expenseLeaves.filter((a: any) => a.actual[i] > a.budget[i]).sort((a: any, b: any) => b.actual[i] / b.budget[i] - a.actual[i] / a.budget[i]);
    const near = expenseLeaves.filter((a: any) => a.actual[i] <= a.budget[i] && a.actual[i] >= a.budget[i] * 0.9);
    for (const a of over.slice(0, 5)) {
      alerts.push({ level: 'danger', text: `${a.name} superó su presupuesto del mes: $${Math.round(a.actual[i]).toLocaleString('es-CL')} de $${Math.round(a.budget[i]).toLocaleString('es-CL')} (${Math.round((a.actual[i] / a.budget[i]) * 100)} %)` });
    }
    for (const a of near.slice(0, 3)) {
      alerts.push({ level: 'warning', text: `${a.name} va en ${Math.round((a.actual[i] / a.budget[i]) * 100)} % de su presupuesto del mes` });
    }
    const active = bankAccounts.filter((b) => !b.archived);
    for (const b of active.filter((b) => b.balance < 0 && b.type !== 'CREDIT_CARD')) {
      alerts.push({ level: 'danger', text: `${b.name} tiene saldo negativo: $${Math.round(b.balance).toLocaleString('es-CL')}` });
    }
    const pending = active.reduce((s, b) => s + b.pendingCount, 0);
    if (pending) alerts.push({ level: 'info', text: `${pending} línea(s) de cartola por conciliar` });
    for (const r of upcoming.slice(0, 5)) {
      alerts.push({ level: 'info', text: `Vence el ${r.date!.split('-').reverse().join('-')}: ${r.description} ($${Math.round(r.amount).toLocaleString('es-CL')})` });
    }

    return {
      year, month,
      income: { budget: t.INCOME.budget[i], actual: t.INCOME.actual[i] },
      expense: { budget: t.EXPENSE.budget[i], actual: t.EXPENSE.actual[i] },
      result: { budget: round2(t.INCOME.budget[i] - t.EXPENSE.budget[i]), actual: round2(t.INCOME.actual[i] - t.EXPENSE.actual[i]) },
      cash: {
        total: round2(active.filter((b) => b.type !== 'CREDIT_CARD').reduce((s, b) => s + b.balance, 0)),
        accounts: active.map((b) => ({ id: b.id, name: b.name, type: b.type, balance: b.balance })),
      },
      upcoming,
      alerts,
    };
  }

  // Proyección de los próximos meses: parte del saldo actual de bancos y caja y suma, por mes,
  // el resultado presupuestado; si un mes no tiene presupuesto, usa el promedio real de los
  // últimos 3 meses cerrados. Es una estimación sin IVA (el IVA débito y crédito se compensan
  // en el pago mensual al SII).
  async cashflow(user: any, companyIdParam: string | undefined, months = 6) {
    const companyId = this.finance.resolveCompanyId(user, companyIdParam);
    const { year, month } = await this.currentMonth();
    const years = [...new Set([year - 1, year, year + 1])];
    const reports = new Map<number, any>();
    for (const y of years) reports.set(y, await this.finance.report(user, companyId, y));
    const at = (y: number, m: number, type: 'INCOME' | 'EXPENSE', k: 'budget' | 'actual') => {
      // m puede salirse de 1..12: se normaliza al año que corresponde.
      const yy = y + Math.floor((m - 1) / 12);
      const mm = ((m - 1) % 12 + 12) % 12;
      return reports.get(yy)?.totals[type][k][mm] ?? 0;
    };
    const avg = (type: 'INCOME' | 'EXPENSE') => round2((at(year, month - 1, type, 'actual') + at(year, month - 2, type, 'actual') + at(year, month - 3, type, 'actual')) / 3);
    const avgIncome = avg('INCOME');
    const avgExpense = avg('EXPENSE');

    const bankAccounts = await this.banks.listBankAccounts(user, companyId);
    const cashAccounts = bankAccounts.filter((b) => !b.archived);
    let balance = round2(cashAccounts.reduce((s, b) => s + b.balance, 0));
    const startBalance = balance;
    const rows = [];
    for (let k = 0; k < months; k++) {
      const m = month + k;
      const y = year + Math.floor((m - 1) / 12);
      const mm = ((m - 1) % 12) + 1;
      const bIncome = at(year, m, 'INCOME', 'budget');
      const bExpense = at(year, m, 'EXPENSE', 'budget');
      const income = bIncome || avgIncome;
      const expense = bExpense || avgExpense;
      // El mes en curso ya tiene parte de lo real: se proyecta solo lo que falta.
      const doneIncome = k === 0 ? at(year, m, 'INCOME', 'actual') : 0;
      const doneExpense = k === 0 ? at(year, m, 'EXPENSE', 'actual') : 0;
      const net = round2(Math.max(0, income - doneIncome) - Math.max(0, expense - doneExpense));
      balance = round2(balance + net);
      rows.push({
        year: y, month: mm, income: round2(income), expense: round2(expense), net, balance,
        source: bIncome || bExpense ? 'budget' : 'average',
      });
    }
    return { startBalance, hasBankAccounts: cashAccounts.length > 0, averages: { income: avgIncome, expense: avgExpense }, rows };
  }
}
