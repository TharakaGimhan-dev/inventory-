// invoice.service.ts raises invoice numbers.
//
// Same rule as an asset code, for the same reason: a number that has been sent
// to a customer is in their accountant's file, so it is never reused and the
// sequence never rewinds. An invoice raised in error is voided, not deleted.
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Invoice, InvoiceStatus } from '../models/invoice.model';

@Injectable()
export class InvoiceService {
  constructor(
    @InjectModel(Invoice) private readonly invoices: typeof Invoice,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * The next invoice number, global rather than per tenant.
   *
   * Accounting reads one continuous series; a gap in it is a question from an
   * auditor, and a per-tenant series would produce many.
   */
  async nextNumber(transaction: Transaction): Promise<string> {
    const rows = await this.sequelize.query<{ value: number }>(
      `INSERT INTO invoice_counter ("id","value") VALUES (1, 1)
       ON CONFLICT ("id") DO UPDATE SET "value" = invoice_counter."value" + 1
       RETURNING "value"`,
      { type: QueryTypes.SELECT, transaction },
    );

    const value = rows[0]?.value ?? 1;
    const year = new Date().getFullYear();
    return `INV-${year}-${String(value).padStart(5, '0')}`;
  }

  async create(
    data: {
      tenantId: string;
      subscriptionId: string | null;
      amount: string;
      currency: string;
      status: InvoiceStatus;
      providerRef?: string | null;
      paidAt?: Date | null;
      note?: string | null;
    },
    transaction: Transaction,
  ) {
    return this.invoices.create(
      { ...data, number: await this.nextNumber(transaction) } as any,
      { transaction },
    );
  }

  list(tenantId: string) {
    return this.invoices.findAll({
      where: { tenantId },
      order: [['createdAt', 'DESC']],
      limit: 100,
    });
  }
}
