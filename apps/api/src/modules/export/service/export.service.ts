// export.service.ts turns the register into a file the customer can keep.
//
// CSV is available on every plan and in every subscription state - it is the
// promise that they can always leave, and it costs us a lever we have decided
// not to hold. Excel and PDF are paid, because they are convenience rather
// than access.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import ExcelJS from 'exceljs';
import { Asset } from '../../asset/models/asset.model';
import { Category } from '../../asset/models/category.model';
import { Location } from '../../asset/models/location.model';
import { STATUS_LABELS } from './labels';
import { UTF8_BOM, toCsv } from './csv';

const HEADERS = [
  'Code', 'Name', 'Type', 'Status', 'Condition', 'Category', 'Location',
  'Serial number', 'Quantity', 'Purchase date', 'Purchase price',
  'Replacement value', 'Supplier', 'Warranty ends', 'Created',
];

@Injectable()
export class ExportService {
  constructor(@InjectModel(Asset) private readonly assets: typeof Asset) {}

  /** Every asset in the tenant, newest first. The hook scopes it. */
  private async rows() {
    const assets = await this.assets.findAll({
      include: [
        { model: Category, attributes: ['name'] },
        { model: Location, attributes: ['name'] },
      ],
      order: [['code', 'ASC']],
    });

    return assets.map((a) => [
      a.code,
      a.name,
      a.kind,
      STATUS_LABELS[a.status] ?? a.status,
      a.condition,
      a.category?.name ?? '',
      a.location?.name ?? '',
      a.serialNumber ?? '',
      a.quantity,
      a.purchaseDate ?? '',
      a.purchasePrice ?? '',
      a.replacementValue ?? '',
      a.supplier ?? '',
      a.warrantyEndsAt ?? '',
      a.createdAt.toISOString().slice(0, 10),
    ]);
  }

  async csv(): Promise<{ body: string; filename: string }> {
    const rows = await this.rows();

    return {
      // The BOM is what makes Excel read it as UTF-8. Without it a Sinhala
      // asset name opens as mojibake and the customer thinks we lost their data.
      body: UTF8_BOM + toCsv(HEADERS, rows),
      filename: filename('csv'),
    };
  }

  async xlsx(): Promise<{ body: Buffer; filename: string }> {
    const rows = await this.rows();

    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Assets');

    sheet.addRow(HEADERS);
    sheet.getRow(1).font = { bold: true };
    // Frozen, so scrolling a thousand rows does not lose the column names.
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const row of rows) sheet.addRow(row);

    // Numbers as numbers, so a total in Excel works without retyping the column.
    for (const column of [11, 12]) {
      sheet.getColumn(column).numFmt = '#,##0.00';
      sheet.getColumn(column).alignment = { horizontal: 'right' };
    }

    sheet.columns.forEach((column, index) => {
      const longest = Math.max(
        HEADERS[index]?.length ?? 10,
        ...rows.map((r) => String(r[index] ?? '').length),
      );
      column.width = Math.min(Math.max(longest + 2, 10), 40);
    });

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: HEADERS.length },
    };

    return {
      body: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: filename('xlsx'),
    };
  }

  /** Totals for the dashboard and the PDF summary. */
  async summary() {
    const assets = await this.assets.findAll({
      include: [
        { model: Category, attributes: ['name'] },
        { model: Location, attributes: ['name'] },
      ],
    });

    const byStatus: Record<string, number> = {};
    const byLocation: Record<string, number> = {};
    let purchaseTotal = 0;
    let replacementTotal = 0;

    for (const asset of assets) {
      byStatus[asset.status] = (byStatus[asset.status] ?? 0) + 1;

      const where = asset.location?.name ?? 'Unassigned';
      byLocation[where] = (byLocation[where] ?? 0) + 1;

      // Parsed from the DECIMAL string only here, at the point of summing.
      purchaseTotal += Number(asset.purchasePrice ?? 0);
      replacementTotal += Number(asset.replacementValue ?? 0);
    }

    return {
      count: assets.length,
      byStatus,
      byLocation,
      purchaseTotal: purchaseTotal.toFixed(2),
      replacementTotal: replacementTotal.toFixed(2),
    };
  }
}

function filename(extension: string): string {
  return `asset-register-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
