window.prepareStaffReport = function (root) {
  root.querySelectorAll('table.rpt-table').forEach(table => {
    const headers = Array.from(table.tHead?.rows[0]?.cells || []);
    if (headers[0]?.textContent.trim() === '#') {
      headers[0].classList.add('report-row-number');
      Array.from(table.tBodies).forEach(body => Array.from(body.rows).forEach(row => {
        if (row.cells.length === headers.length) row.cells[0].classList.add('report-row-number');
      }));
    }
    const emailIndex = headers.findIndex(cell => /^(gmail|email)$/i.test(cell.textContent.trim()));
    if (emailIndex >= 0) {
      headers[emailIndex].classList.add('report-email');
      Array.from(table.tBodies).forEach(body => Array.from(body.rows).forEach(row => {
        if (row.cells.length === headers.length) row.cells[emailIndex].classList.add('report-email');
      }));
    }
  });
};
