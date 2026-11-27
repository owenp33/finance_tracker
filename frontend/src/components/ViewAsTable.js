// A chart's numbers as a table, collapsed under the chart (Phase V: every chart has one). `rows` are
// arrays of cells in `columns` order; the first cell names the row and must be unique. `summary`
// is what the collapsed line says; `note`, a line above the table.
function ViewAsTable({ caption, columns, rows, summary = 'View as table', note }) {
  return (
    <details className="view-as-table">
      <summary>{summary}</summary>
      {note && <p className="view-as-table-note">{note}</p>}
      <div className="view-as-table-scroll">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(([name, ...cells]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                {cells.map((cell, i) => <td key={columns[i + 1]}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default ViewAsTable;
