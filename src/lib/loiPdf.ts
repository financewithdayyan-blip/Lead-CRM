import { jsPDF } from 'jspdf';

/** Plain paragraph layout — the LOI body is just text, no letterhead/imagery yet. */
export function downloadLoiPdf(body: string, fileName: string) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 56;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - margin * 2;
  const lineHeight = 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);

  let y = margin;
  const paragraphs = body.split(/\n\s*\n/);
  for (const para of paragraphs) {
    const lines = doc.splitTextToSize(para.replace(/\n/g, ' '), usableWidth);
    for (const line of lines) {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += lineHeight;
    }
    y += lineHeight; // blank line between paragraphs
  }

  doc.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}
