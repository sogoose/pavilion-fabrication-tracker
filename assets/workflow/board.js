/* Workflow board: native expanding drawings and a safe Tracker shortcut.
   Module data and the Rhino viewer remain owned by the existing application. */
(function () {
  const board = document.getElementById('workflowView');
  if (!board) return;

  board.querySelectorAll('.wb-tracker-link').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      document.getElementById('navTracker')?.click();
    });
  });

  // <details name="workflow-detail"> keeps the open drawing in normal
  // document flow, unlike an overlay, so adjacent drawings never overlap.
  board.querySelectorAll('details.wb-block').forEach(detail => {
    detail.addEventListener('toggle', () => {
      const label = detail.querySelector('.wb-plus');
      if (label) label.textContent = detail.open ? '×' : '+';
    });
  });
})();
