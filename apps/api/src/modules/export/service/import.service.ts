// import.service.ts brings an existing register in from a spreadsheet.
//
// This is the first thing a new customer needs: their assets are already in an
// Excel file, and retyping four hundred rows is why they would not switch.
//
// Two rules shape it. Nothing is written unless the whole file is valid, so a
// customer never ends up with half an import and no idea which half. And the
// plan limit is checked against the whole file up front, so they are told
// "this file needs 400 slots and you have 100" instead of discovering it on
// row 101.
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuditAction } from '../../../common/constants/asset';
import { PlanLimitExceededException } from '../../../common/exceptions/plan-limit.exception';
import { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { AuditService } from '../../audit/service/audit.service';
import { UsageMetric } from '../../billing/models/usage-counter.model';
import { PlanService } from '../../billing/service/plan.service';
import { UsageService } from '../../billing/service/usage.service';
import { Asset } from '../../asset/models/asset.model';
import { Category } from '../../asset/models/category.model';
import { Location } from '../../asset/models/location.model';
import { AssetCodeService } from '../../asset/service/asset-code.service';

export type ImportRow = {
  line: number;
  name: string;
  serialNumber?: string;
  status?: string;
  condition?: string;
  category?: string;
  location?: string;
  purchasePrice?: string;
  quantity?: number;
};

export type ImportProblem = { line: number; column: string; message: string };

export type ImportResult = {
  imported: number;
  problems: ImportProblem[];
  createdLocations: string[];
  createdCategories: string[];
};

const VALID_STATUS = new Set([
  'in_use', 'in_store', 'repair', 'written_off', 'disposed',
]);
const VALID_CONDITION = new Set(['new', 'good', 'fair', 'poor']);

/** Column names accepted in the header row, lower-cased. */
const COLUMNS: Record<string, keyof ImportRow> = {
  name: 'name',
  'item': 'name',
  'asset name': 'name',
  'serial': 'serialNumber',
  'serial number': 'serialNumber',
  status: 'status',
  condition: 'condition',
  category: 'category',
  location: 'location',
  'purchase price': 'purchasePrice',
  price: 'purchasePrice',
  cost: 'purchasePrice',
  quantity: 'quantity',
  qty: 'quantity',
};

@Injectable()
export class ImportService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly codes: AssetCodeService,
    private readonly usage: UsageService,
    private readonly plans: PlanService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Reads a CSV into rows, collecting every problem rather than stopping at
   * the first. A customer fixing a file wants the whole list, not one error at
   * a time.
   */
  parse(csv: string): { rows: ImportRow[]; problems: ImportProblem[] } {
    const lines = splitLines(csv);
    const problems: ImportProblem[] = [];
    const rows: ImportRow[] = [];

    if (lines.length === 0) {
      return { rows, problems: [{ line: 0, column: '', message: 'The file is empty' }] };
    }

    const header = parseLine(lines[0]).map((h) =>
      h.trim().toLowerCase().replace(/^﻿/, ''),
    );
    const mapping = header.map((h) => COLUMNS[h]);

    if (!mapping.includes('name')) {
      return {
        rows,
        problems: [
          {
            line: 1,
            column: 'name',
            message:
              'The file needs a "Name" column. Recognised columns: ' +
              Object.keys(COLUMNS).join(', '),
          },
        ],
      };
    }

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;

      const cells = parseLine(lines[i]);
      const row: ImportRow = { line: i + 1, name: '' };

      mapping.forEach((field, index) => {
        if (!field) return;
        const value = (cells[index] ?? '').trim();
        if (!value) return;

        if (field === 'quantity') {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 1) {
            problems.push({
              line: i + 1,
              column: 'quantity',
              message: `"${value}" is not a whole number of items`,
            });
            return;
          }
          row.quantity = n;
          return;
        }

        (row as Record<string, unknown>)[field] = value;
      });

      if (!row.name) {
        problems.push({ line: i + 1, column: 'name', message: 'Name is required' });
        continue;
      }

      if (row.status && !VALID_STATUS.has(normalise(row.status))) {
        problems.push({
          line: i + 1,
          column: 'status',
          message: `"${row.status}" is not a status. Use: ${[...VALID_STATUS].join(', ')}`,
        });
      } else if (row.status) {
        row.status = normalise(row.status);
      }

      if (row.condition && !VALID_CONDITION.has(row.condition.toLowerCase())) {
        problems.push({
          line: i + 1,
          column: 'condition',
          message: `"${row.condition}" is not a condition. Use: ${[...VALID_CONDITION].join(', ')}`,
        });
      } else if (row.condition) {
        row.condition = row.condition.toLowerCase();
      }

      if (row.purchasePrice) {
        const cleaned = row.purchasePrice.replace(/[,\s]/g, '');
        if (!/^\d{1,10}(\.\d{1,2})?$/.test(cleaned)) {
          problems.push({
            line: i + 1,
            column: 'purchase price',
            message: `"${row.purchasePrice}" is not an amount`,
          });
        } else {
          row.purchasePrice = cleaned;
        }
      }

      rows.push(row);
    }

    return { rows, problems };
  }

  /**
   * Writes the rows, or none of them.
   *
   * One transaction covering every asset, every code, the usage counter and
   * the audit entry: a file that fails halfway leaves nothing behind.
   */
  async apply(
    rows: ImportRow[],
    user: AuthenticatedUser,
  ): Promise<ImportResult> {
    const limits = await this.plans.effectiveLimits(user.tenantId);

    // Checked against the whole file before anything is written, so the answer
    // is "this file needs 400 slots and you have 100" rather than a refusal on
    // row 101 with 100 rows already imported.
    if (!PlanService.isUnlimited(limits.assets)) {
      const current = await this.usage.current(UsageMetric.ASSETS, user.tenantId);
      if (current + rows.length > limits.assets) {
        throw new PlanLimitExceededException(
          UsageMetric.ASSETS,
          limits.assets,
          current,
        );
      }
    }

    return this.sequelize.transaction(async (transaction) => {
      const locations = await this.lookup(Location, transaction);
      const categories = await this.lookup(Category, transaction);
      const createdLocations: string[] = [];
      const createdCategories: string[] = [];

      for (const row of rows) {
        // Locations and categories named in the file are created as needed.
        // Making the customer pre-create forty rooms before importing is how
        // an import turns into an afternoon.
        let locationId: string | null = null;
        if (row.location) {
          const key = row.location.toLowerCase();
          if (!locations.has(key)) {
            const created = await Location.create(
              { name: row.location } as any,
              { transaction },
            );
            locations.set(key, created.id);
            createdLocations.push(row.location);
            await this.usage.change(UsageMetric.LOCATIONS, 1, transaction);
          }
          locationId = locations.get(key)!;
        }

        let categoryId: string | null = null;
        if (row.category) {
          const key = row.category.toLowerCase();
          if (!categories.has(key)) {
            const created = await Category.create(
              { name: row.category } as any,
              { transaction },
            );
            categories.set(key, created.id);
            createdCategories.push(row.category);
          }
          categoryId = categories.get(key)!;
        }

        await Asset.create(
          {
            code: await this.codes.next(transaction),
            name: row.name,
            serialNumber: row.serialNumber ?? null,
            status: row.status ?? 'in_use',
            condition: row.condition ?? 'good',
            purchasePrice: row.purchasePrice ?? null,
            quantity: row.quantity ?? 1,
            locationId,
            categoryId,
            createdByUserId: user.id,
          } as any,
          { transaction },
        );
      }

      await this.usage.change(UsageMetric.ASSETS, rows.length, transaction);

      // One entry for the import, not one per row: a trail with four hundred
      // near-identical lines in it is one nobody reads.
      await this.audit.record(
        {
          actorUserId: user.id,
          entity: 'import',
          entityId: user.tenantId,
          action: AuditAction.CREATE,
          after: {
            imported: rows.length,
            locationsCreated: createdLocations.length,
            categoriesCreated: createdCategories.length,
          },
        },
        transaction,
      );

      return {
        imported: rows.length,
        problems: [],
        createdLocations,
        createdCategories,
      };
    });
  }

  private async lookup(model: any, transaction: any): Promise<Map<string, string>> {
    const rows = await model.findAll({ transaction });
    return new Map(
      rows.map((r: { name: string; id: string }) => [r.name.toLowerCase(), r.id]),
    );
  }
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Splits on newlines that are not inside a quoted field. */
function splitLines(csv: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];

    if (char === '"') {
      // A doubled quote inside a quoted field is an escaped quote.
      if (inQuotes && csv[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && csv[i + 1] === '\n') i++;
      lines.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current) lines.push(current);
  return lines;
}

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}
