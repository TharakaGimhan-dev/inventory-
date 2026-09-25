// pdf.service.ts draws the two printable things: a summary report and a sheet
// of QR labels.
//
// Labels are the feature that makes the register real. A code in a database
// nobody can read off the equipment is a spreadsheet; a code on a sticker that
// a phone can scan is an inventory system.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { Op } from 'sequelize';
import { Asset } from '../../asset/models/asset.model';
import { ExportService } from './export.service';
import { STATUS_LABELS } from './labels';

// A4 in points, and a 3 x 8 grid of 63.5 x 33.9 mm labels - the common
// Avery L7160 / 24-per-sheet stock, which is what is actually on the shelf in
// a Colombo stationery shop.
const PAGE = { width: 595.28, height: 841.89 };
const GRID = { columns: 3, rows: 8 };
const MARGIN = { x: 20, y: 36 };
const GUTTER = { x: 8, y: 0 };

@Injectable()
export class PdfService {
  constructor(
    @InjectModel(Asset) private readonly assets: typeof Asset,
    private readonly exports: ExportService,
  ) {}

  /**
   * A sheet of QR labels.
   *
   * The QR encodes the asset code itself, not a URL. A URL ties every printed
   * label to a domain we would then be unable to change, and a code scanned
   * anywhere still identifies the asset.
   */
  async labels(assetIds?: string[]): Promise<Buffer> {
    const assets = await this.assets.findAll({
      where: assetIds?.length ? { id: { [Op.in]: assetIds } } : {},
      order: [['code', 'ASC']],
      limit: 480, // 20 sheets; beyond that it is a print job, not a download
    });

    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    const cellWidth =
      (PAGE.width - MARGIN.x * 2 - GUTTER.x * (GRID.columns - 1)) / GRID.columns;
    const cellHeight =
      (PAGE.height - MARGIN.y * 2 - GUTTER.y * (GRID.rows - 1)) / GRID.rows;

    const perPage = GRID.columns * GRID.rows;

    for (const [index, asset] of assets.entries()) {
      if (index > 0 && index % perPage === 0) doc.addPage();

      const slot = index % perPage;
      const column = slot % GRID.columns;
      const row = Math.floor(slot / GRID.columns);

      const x = MARGIN.x + column * (cellWidth + GUTTER.x);
      const y = MARGIN.y + row * (cellHeight + GUTTER.y);

      // margin 0 on the QR itself: pdfkit places it, and the library's own
      // quiet zone would eat a third of a label this size.
      const png = await QRCode.toBuffer(asset.code, {
        type: 'png',
        margin: 0,
        width: 200,
        errorCorrectionLevel: 'M',
      });

      const qrSize = cellHeight - 16;
      doc.image(png, x + 6, y + 8, { width: qrSize, height: qrSize });

      const textX = x + qrSize + 14;
      const textWidth = cellWidth - qrSize - 20;

      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(asset.code, textX, y + 12, { width: textWidth, lineBreak: false });

      doc
        .font('Helvetica')
        .fontSize(7.5)
        .text(asset.name, textX, y + 26, {
          width: textWidth,
          height: 22,
          ellipsis: true,
        });

      doc
        .fontSize(6.5)
        .fillColor('#666666')
        .text(STATUS_LABELS[asset.status] ?? asset.status, textX, y + cellHeight - 18, {
          width: textWidth,
          lineBreak: false,
        })
        .fillColor('#000000');
    }

    if (assets.length === 0) {
      doc.font('Helvetica').fontSize(12).text('Nothing to print yet.', 60, 60);
    }

    doc.end();
    return finish(doc, chunks);
  }

  /** A one-page summary: counts, totals, and where things are. */
  async report(organisationName: string): Promise<Buffer> {
    const summary = await this.exports.summary();

    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    doc.font('Helvetica-Bold').fontSize(18).text('Asset register');
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#555555')
      .text(organisationName)
      .text(`As at ${new Date().toISOString().slice(0, 10)}`)
      .fillColor('#000000')
      .moveDown(1.2);

    doc.font('Helvetica-Bold').fontSize(13).text('Totals').moveDown(0.4);
    doc.font('Helvetica').fontSize(11);
    doc.text(`Items: ${summary.count}`);
    doc.text(`Purchase value: LKR ${format(summary.purchaseTotal)}`);
    doc.text(`Replacement value: LKR ${format(summary.replacementTotal)}`);
    doc.moveDown(1);

    section(doc, 'By status', summary.byStatus, (key) => STATUS_LABELS[key] ?? key);
    section(doc, 'By location', summary.byLocation);

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#888888')
      .text(
        'Replacement values are those recorded in the register and are not a valuation.',
        48,
        doc.page.height - 64,
        { width: PAGE.width - 96 },
      );

    doc.end();
    return finish(doc, chunks);
  }
}

function section(
  doc: PDFKit.PDFDocument,
  title: string,
  counts: Record<string, number>,
  label: (key: string) => string = (k) => k,
) {
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text(title).moveDown(0.4);
  doc.font('Helvetica').fontSize(11);

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    doc.fillColor('#888888').text('Nothing recorded').fillColor('#000000');
  }

  for (const [key, count] of entries) {
    doc.text(`${label(key)}: ${count}`);
  }

  doc.moveDown(1);
}

const format = (amount: string) =>
  Number(amount).toLocaleString('en-LK', { minimumFractionDigits: 2 });

/** pdfkit streams; the buffer is only complete once it says so. */
function finish(doc: PDFKit.PDFDocument, chunks: Buffer[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
