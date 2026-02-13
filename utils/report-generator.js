/**
 * Smart School Helper — Report Generator
 *
 * Generates a formatted report of scheduled practical lessons for subgroups.
 * Supports: plain text (clipboard), CSV, and XLSX (via simple XML-based approach).
 */

const ReportGenerator = (() => {

  /**
   * Generate a report from selected free slots.
   *
   * @param {object} params
   * @param {Array}  params.slots        — selected free slot objects
   * @param {string} params.discipline   — discipline name
   * @param {string} params.teacherName  — teacher name
   * @param {string} params.groupName    — group name
   * @param {string} params.subgroupLabel— e.g. "2 підгрупа"
   * @param {string} params.format       — 'xlsx' | 'csv' | 'clipboard'
   * @returns {object} { preview: string, blob?: Blob, filename?: string }
   */
  function generate(params) {
    const { slots, discipline, teacherName, groupName, subgroupLabel, format } = params;

    // Build table data
    const headers = ['№', 'Дата', 'День', 'Пара', 'Час', 'Дисципліна', 'Група', 'Підгрупа', 'Викладач'];
    const rows = slots.map((slot, index) => [
      index + 1,
      slot.dateUA || SmartSchoolConfig.formatDateUA(slot.date),
      slot.dayName,
      slot.pairNumber,
      `${slot.timeStart}–${slot.timeEnd}`,
      discipline || '',
      groupName || '',
      subgroupLabel || '2 підгрупа',
      teacherName || '',
    ]);

    // Generate preview text
    const preview = generatePlainText(headers, rows);

    switch (format) {
      case 'csv':
        return {
          preview,
          blob: generateCSVBlob(headers, rows),
          filename: `Графік_практичних_${discipline || 'звіт'}.csv`,
        };
      case 'xlsx':
        return {
          preview,
          blob: generateXLSXBlob(headers, rows, discipline),
          filename: `Графік_практичних_${discipline || 'звіт'}.xlsx`,
        };
      case 'clipboard':
      default:
        return { preview };
    }
  }

  /**
   * Copy the report text to clipboard.
   */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    }
  }

  /**
   * Trigger download of a Blob.
   */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ---------- Format Generators ---------- */

  /**
   * Plain text table (for preview and clipboard).
   */
  function generatePlainText(headers, rows) {
    // Calculate column widths
    const allRows = [headers, ...rows.map((r) => r.map(String))];
    const widths = headers.map((_, i) =>
      Math.max(...allRows.map((row) => (row[i] || '').length))
    );

    const separator = widths.map((w) => '─'.repeat(w + 2)).join('┼');
    const formatRow = (row) =>
      row.map((cell, i) => ` ${String(cell).padEnd(widths[i])} `).join('│');

    const lines = [];
    lines.push(`ГРАФІК ПРАКТИЧНИХ РОБІТ`);
    lines.push('');
    lines.push(formatRow(headers));
    lines.push(separator);
    rows.forEach((row) => lines.push(formatRow(row.map(String))));
    lines.push('');
    lines.push(`Усього занять: ${rows.length}`);

    return lines.join('\n');
  }

  /**
   * CSV blob with BOM for proper Ukrainian encoding in Excel.
   */
  function generateCSVBlob(headers, rows) {
    const BOM = '\uFEFF';
    const escape = (val) => {
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    const csvLines = [
      headers.map(escape).join(','),
      ...rows.map((row) => row.map(escape).join(',')),
    ];

    return new Blob([BOM + csvLines.join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
  }

  /**
   * Generate a simple XLSX-compatible file using SpreadsheetML XML.
   * This avoids the need for external libraries.
   */
  function generateXLSXBlob(headers, rows, title) {
    const xmlRows = [headers, ...rows.map((r) => r.map(String))];

    const cellsXML = xmlRows.map((row) => {
      const cells = row.map((cell) => {
        const type = typeof cell === 'number' ? 'Number' : 'String';
        return `<Cell><Data ss:Type="${type}">${escapeXML(String(cell))}</Data></Cell>`;
      }).join('');
      return `<Row>${cells}</Row>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="header">
   <Font ss:Bold="1" ss:Size="11"/>
   <Interior ss:Color="#D9E2F3" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${escapeXML(title || 'Графік')}">
  <Table>
   ${cellsXML}
  </Table>
 </Worksheet>
</Workbook>`;

    return new Blob([xml], {
      type: 'application/vnd.ms-excel',
    });
  }

  function escapeXML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- Public API ---------- */

  return {
    generate,
    copyToClipboard,
    downloadBlob,
  };
})();
