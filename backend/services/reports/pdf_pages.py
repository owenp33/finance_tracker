"""
pdf_pages.py - The PDF report's pages, drawn with matplotlib (one figure per page)

Each render_* function adds pages to an open PdfPages: the summary pages from
AnalyticsService.generate_report and summary_data, and an account's pages from its AccountLedger.
"""
from datetime import date, timedelta
from math import nan
import matplotlib
matplotlib.use('Agg')   # no display: render straight to files
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib.colors import to_rgba
from matplotlib.lines import Line2D
from matplotlib.patches import Patch, Rectangle
from matplotlib.table import Table
from matplotlib.ticker import FuncFormatter

# Pages with a chart over a table (portrait): the first holds the chart and the start of the table
FIRST_PAGE_ROWS = 20          # table rows under the chart
CONTINUED_ROWS = 40           # table rows on each following page
FIRST_TABLE_TOP = 0.50        # where the table starts, as a fraction of the page height
CONTINUED_TABLE_TOP = 0.92
ROW_HEIGHT = 0.021            # one table row, as a fraction of the page height
VENDOR_CHARS = 34             # longer text is cut short with an ellipsis
CATEGORY_CHARS = 20
ACCOUNT_COLUMNS = [           # (header, share of the table width, alignment)
    ('Date', 0.13, 'left'), ('Vendor', 0.35, 'left'), ('Category', 0.21, 'left'),
    ('Amount', 0.11, 'right'), ('Balance', 0.12, 'right'), ('Budget', 0.08, 'center'),
]
ACCOUNT_NOTE = ('Includes transfers, which the summary pages leave out. '
                'Rows marked "Over" are over their category\'s monthly budget.')

# Colors for print: text inks, the app's chart hues (Phase V), a light wash for over-budget rows
INK = '#0b0b0b'
INK_SECONDARY = '#52514e'
INK_MUTED = '#898781'
GRIDLINE = '#e1e0d9'
BASELINE = '#c3c2b7'
HEADER_FILL = '#f3f2ee'
BALANCE_LINE = '#2a78d6'
NET_IN = '#1baf7a'            # aqua: more in than out
NET_OUT = '#eb6834'           # orange: more out than in
PARTIAL_ALPHA = 0.35          # a month only partly in the period
OVER_BUDGET_WASH = '#f9e1e1'


def render_summary_page(pdf, analytics, period_label, generated_label):
    summary = analytics['summary']
    trends = analytics['trends']

    fig, ax = plt.subplots(figsize=(8.5, 11))
    ax.axis('off')

    lines = [
        ('Financial Report', 20, 'bold'),
        (f'Period: {period_label}', 12, 'normal'),
        (f'Generated: {generated_label}', 10, 'normal'),
        ('', 12, 'normal'),
        (f"Total Income: ${summary['total_income']:,.2f}", 14, 'normal'),
        (f"Total Expenses: ${summary['total_expenses']:,.2f}", 14, 'normal'),
        (f"Net Amount: ${summary['net_amount']:,.2f}", 14, 'normal'),
        (f"Transactions: {summary['transaction_count']}", 12, 'normal'),
        (f"Average Transaction: ${summary['avg_transaction']:,.2f}", 12, 'normal'),
        ('', 12, 'normal'),
        (f"Avg Weekly Income: ${trends['weekly_avg_income']:,.2f}", 12, 'normal'),
        (f"Avg Weekly Expenses: ${trends['weekly_avg_expenses']:,.2f}", 12, 'normal'),
    ]

    y = 0.95
    for text, size, weight in lines:
        ax.text(0.05, y, text, fontsize=size, fontweight=weight, transform=ax.transAxes)
        y -= 0.05 if size <= 12 else 0.07

    pdf.savefig(fig)
    plt.close(fig)


# NET PER MONTH =================================================================
# As on the app's Insights Overview (Phase V, V5c)

NET_TITLE = 'Net per month'
NET_NOTE = 'Money in minus money out each month, transfers left out; a month only partly in the period is lighter.'
AVERAGE_LABEL = '3-month average of full months'
NET_COLUMNS = [               # (header, share of the table width, alignment)
    ('Month', 0.28, 'left'), ('Money in', 0.18, 'right'), ('Money out', 0.18, 'right'),
    ('Net', 0.18, 'right'), ('3-month average', 0.18, 'right'),
]
MIN_MONTH_SLOTS = 6           # a few months still get bars this narrow, centred
ALL_TICKS_UP_TO = 8           # months; a longer run labels only its first month, Januaries and Julys


def render_net_per_month_pages(pdf, rows, period_label):
    """
    Net per month: bars around $0 (aqua above, orange below; a month only partly in the period
    lighter) with the 3-month average of full months as a line, then the numbers as a table, on
    as many pages as it needs. `rows` are summary_data.monthly_net's.
    """
    for number, chunk in enumerate(page_chunks(rows)):
        fig = plt.figure(figsize=(8.5, 11))
        if number == 0:
            _page_header(fig, NET_TITLE, period_label, NET_NOTE)
            _net_chart(fig, rows)
            table_top = FIRST_TABLE_TOP
        else:
            _continued_header(fig, NET_TITLE)
            table_top = CONTINUED_TABLE_TOP
        _table(fig, NET_COLUMNS, [(_net_cells(row), False) for row in chunk], table_top)
        pdf.savefig(fig)
        plt.close(fig)


def _net_chart(fig, rows):
    """The bars on a $0 line, the average line, month ticks, and a legend under them."""
    x = list(range(len(rows)))
    ax = fig.add_axes([0.10, 0.60, 0.80, 0.27])
    colors = [to_rgba(NET_OUT if row['net'] < 0 else NET_IN, PARTIAL_ALPHA if row['partial'] else 1)
              for row in rows]
    ax.bar(x, [row['net'] / 100 for row in rows], width=0.7, color=colors, zorder=2)
    ax.axhline(0, color=BASELINE, linewidth=1, zorder=1)
    ax.plot(x, [nan if row['average'] is None else row['average'] / 100 for row in rows],
            color=INK, linewidth=2, marker='o', markersize=3, label=AVERAGE_LABEL, zorder=3)

    pad = max(0.6, (MIN_MONTH_SLOTS - len(rows)) / 2 + 0.6)
    ax.set_xlim(-pad, len(rows) - 1 + pad)
    positions, labels = _month_ticks([row['month'] for row in rows])
    ax.set_xticks(positions, labels=labels)
    _style_axes(ax)
    ax.spines['bottom'].set_visible(False)   # the $0 line is the baseline
    ax.tick_params(axis='x', length=0)
    ax.legend(handles=[
        Patch(color=NET_IN, label='More in than out'),
        Patch(color=NET_OUT, label='More out than in'),
        Line2D([], [], color=INK, linewidth=2, marker='o', markersize=3, label=AVERAGE_LABEL),
    ], loc='upper left', bbox_to_anchor=(0, -0.08), ncol=3, frameon=False, fontsize=8,
        labelcolor=INK_SECONDARY)


def _net_cells(row):
    """A table row: the month (marked partial), money in, money out, net, the average."""
    return [
        _month_label(row['month']) + (' (partial)' if row['partial'] else ''),
        _money(row['income']), _money(row['expenses']), _signed_money(row['net']),
        '—' if row['average'] is None else _signed_money(row['average']),
    ]


def _month_label(month, with_year=True):
    """'2026-03' → 'Mar 2026', or 'Mar'."""
    year, number = map(int, month.split('-'))
    return date(year, number, 1).strftime('%b %Y' if with_year else '%b')


def _month_ticks(months):
    """
    Where and how to label a run of months ('YYYY-MM'): every month of a short run; of a long
    one, the first, Januaries and Julys. The year shows on January and the first.
    """
    shown = [i for i, month in enumerate(months)
             if len(months) <= ALL_TICKS_UP_TO or i == 0 or month.endswith(('-01', '-07'))]
    return shown, [_month_label(months[i], with_year=i == 0 or months[i].endswith('-01')) for i in shown]


def render_category_pie_page(pdf, rows, title):
    fig, ax = plt.subplots(figsize=(8.5, 8.5))
    if rows:
        labels = [r['category'] for r in rows]
        values = [r['total'] for r in rows]
        colors = plt.get_cmap('tab20').colors
        ax.pie(values, labels=labels, autopct='%1.1f%%', colors=colors)
    else:
        ax.text(0.5, 0.5, 'No data available', ha='center', va='center', transform=ax.transAxes)
        ax.axis('off')
    ax.set_title(title)
    fig.tight_layout()
    pdf.savefig(fig)
    plt.close(fig)


def render_top_vendors_page(pdf, vendors):
    fig, ax = plt.subplots(figsize=(11, 8.5))
    if vendors:
        names = [v['vendor'] for v in vendors][::-1]
        amounts = [v['amount'] for v in vendors][::-1]
        ax.barh(names, amounts, color='#FF8042')
        ax.set_xlabel('Amount ($)')
    else:
        ax.text(0.5, 0.5, 'No vendor data available', ha='center', va='center', transform=ax.transAxes)
        ax.axis('off')
    ax.set_title('Top 10 Vendors by Spending')
    fig.tight_layout()
    pdf.savefig(fig)
    plt.close(fig)


def render_breakdown_table_page(pdf, rows):
    fig, ax = plt.subplots(figsize=(8.5, 11))
    ax.axis('off')
    ax.set_title('Spending Breakdown', pad=20)

    if rows:
        table_data = [[r['category'], f"${r['total']:.2f}", f"${r['average']:.2f}", r['count'], f"{r['percentage']}%"] for r in rows]
        table = ax.table(
            cellText=table_data,
            colLabels=['Category', 'Total', 'Average', 'Count', 'Percentage'],
            loc='center',
            cellLoc='center',
        )
        table.auto_set_font_size(False)
        table.set_fontsize(9)
        table.scale(1, 1.5)
    else:
        ax.text(0.5, 0.5, 'No data available', ha='center', va='center', transform=ax.transAxes)

    pdf.savefig(fig)
    plt.close(fig)


# SHARED PIECES =================================================================

def _money(cents):
    """-$1,234.50 / $1,234.50"""
    return f"{'-' if cents < 0 else ''}${abs(cents) / 100:,.2f}"


def _signed_money(cents):
    """+$1,234.50 / -$1,234.50 / $0.00"""
    return f"{'+' if cents > 0 else ''}{_money(cents)}"


def _compact_dollars(value, _position=None):
    """Axis ticks: $0, $500, $1.5K, -$2K."""
    sign, value = ('-' if value < 0 else ''), abs(value)
    if value >= 1000:
        thousands = f'{value / 1000:.1f}'.removesuffix('.0')
        return f'{sign}${thousands}K'
    return f'{sign}${value:,.0f}'


def _shorten(text, limit):
    text = text or ''
    return text if len(text) <= limit else text[:limit - 1] + '…'


def page_chunks(rows):
    """A table's rows split into pages: FIRST_PAGE_ROWS under the page's chart, then CONTINUED_ROWS a page."""
    rest = range(FIRST_PAGE_ROWS, len(rows), CONTINUED_ROWS)
    return [rows[:FIRST_PAGE_ROWS]] + [rows[i:i + CONTINUED_ROWS] for i in rest]


def _page_header(fig, title, subtitle, note):
    """A page's title, the period under it, and a note (dollar signs aren't math)."""
    fig.text(0.06, 0.95, title, fontsize=16, fontweight='bold', color=INK, parse_math=False)
    fig.text(0.06, 0.925, subtitle, fontsize=10, color=INK_SECONDARY, parse_math=False)
    fig.text(0.06, 0.905, note, fontsize=9, color=INK_SECONDARY, parse_math=False)


def _continued_header(fig, title):
    """The title of a page that continues a table."""
    fig.text(0.06, 0.95, f'{title} (continued)', fontsize=12, fontweight='bold', color=INK, parse_math=False)


def _style_axes(ax):
    """Recessive axes for print: compact dollar ticks, a light horizontal grid, only a bottom spine."""
    ax.yaxis.set_major_formatter(FuncFormatter(_compact_dollars))
    ax.grid(axis='y', color=GRIDLINE, linewidth=0.75)
    ax.set_axisbelow(True)
    for side in ('top', 'right', 'left'):
        ax.spines[side].set_visible(False)
    ax.spines['bottom'].set_color(BASELINE)
    ax.tick_params(axis='y', length=0)
    ax.tick_params(colors=BASELINE, labelcolor=INK_MUTED, labelsize=8)


def _table(fig, columns, rows, top):
    """
    A table: the header and `rows` ((cells, highlighted?), one cell per `columns` entry), hanging
    down from `top` (a fraction of the page height). A highlighted row gets a light red band and
    its last cell in bold. Row fills are bands behind the table: cells with only horizontal rules
    are open shapes, which matplotlib doesn't fill.
    """
    count = len(rows) + 1
    ax = fig.add_axes([0.06, top - ROW_HEIGHT * count, 0.88, ROW_HEIGHT * count])
    ax.axis('off')
    table = Table(ax, bbox=[0, 0, 1, 1])
    table.edges = 'horizontal'   # rules between rows, no column lines
    cells = [([header for header, _, _ in columns], None)] + rows
    for r, (texts, highlighted) in enumerate(cells):
        fill = HEADER_FILL if highlighted is None else OVER_BUDGET_WASH if highlighted else None
        if fill:
            ax.add_patch(Rectangle((0, 1 - (r + 1) / count), 1, 1 / count, transform=ax.transAxes,
                                   facecolor=fill, edgecolor='none', zorder=0))
        for c, (text, (_, width, align)) in enumerate(zip(texts, columns)):
            cell = table.add_cell(r, c, width, 1 / count, text=text, loc=align, fill=False,
                                  edgecolor=GRIDLINE)
            cell.get_text().set(color=INK, parse_math=False)
            if highlighted is None or (highlighted and c == len(columns) - 1):
                cell.get_text().set_fontweight('bold')
    table.auto_set_font_size(False)
    table.set_fontsize(8)
    table.set_zorder(1)
    ax.add_table(table)


# ACCOUNT PAGES =================================================================

def account_table_rows(rows, over_budget_ids):
    """(cells, over budget?) for each ledger row, one cell per ACCOUNT_COLUMNS entry."""
    table = []
    for row in rows:
        t = row.transaction
        over = t.id in over_budget_ids
        table.append(([
            t.date.isoformat(),
            _shorten(t.vendor, VENDOR_CHARS),
            _shorten(t.category, CATEGORY_CHARS),
            _money(t.amount_cents),
            _money(row.balance_cents),
            'Over' if over else '',
        ], over))
    return table


def render_account_pages(pdf, ledger, over_budget_ids, period_label, start_date, end_date):
    """
    One account's pages: its balance from start_date to end_date (the export's period) with the
    first rows of its transaction table, then as many pages as the rest of the table needs. The
    ledger must have rows.
    """
    for number, chunk in enumerate(page_chunks(ledger.rows)):
        fig = plt.figure(figsize=(8.5, 11))
        if number == 0:
            _account_header(fig, ledger, period_label)
            _balance_chart(fig, ledger, start_date, end_date)
            fig.text(0.06, 0.515, ACCOUNT_NOTE, fontsize=8, color=INK_SECONDARY)
            table_top = FIRST_TABLE_TOP
        else:
            _continued_header(fig, ledger.account.acct_name)
            table_top = CONTINUED_TABLE_TOP
        _table(fig, ACCOUNT_COLUMNS, account_table_rows(chunk, over_budget_ids), table_top)
        pdf.savefig(fig)
        plt.close(fig)


def _account_header(fig, ledger, period_label):
    """Account name, period and count, opening and closing balance (dollar signs aren't math)."""
    count = len(ledger.rows)
    fig.text(0.06, 0.95, ledger.account.acct_name, fontsize=16, fontweight='bold', color=INK,
             parse_math=False)
    fig.text(0.06, 0.925, f"{period_label} · {count} transaction{'' if count == 1 else 's'}",
             fontsize=10, color=INK_SECONDARY)
    fig.text(0.06, 0.905, f'Opening balance {_money(ledger.opening_cents)}    '
                          f'Closing balance {_money(ledger.closing_cents)}',
             fontsize=10, color=INK_SECONDARY, parse_math=False)


def _balance_chart(fig, ledger, start, end):
    """The running balance as a step line: flat between transactions, from the opening balance."""
    end = max(end, start + timedelta(days=1))   # a one-day period still needs a width
    dates = [start] + [r.transaction.date for r in ledger.rows] + [end]
    cents = [ledger.opening_cents] + [r.balance_cents for r in ledger.rows] + [ledger.closing_cents]
    balances = [c / 100 for c in cents]

    ax = fig.add_axes([0.10, 0.58, 0.76, 0.28])
    ax.step(dates, balances, where='post', color=BALANCE_LINE, linewidth=2,
            solid_joinstyle='round', solid_capstyle='round')
    if min(balances) < 0 < max(balances):
        ax.axhline(0, color=BASELINE, linewidth=1)
    ax.annotate(_money(ledger.closing_cents), xy=(end, balances[-1]), xytext=(4, 0),
                textcoords='offset points', va='center', fontsize=8, color=INK, annotation_clip=False,
                parse_math=False)

    ax.set_title('Balance', loc='left', fontsize=11, color=INK, pad=8)
    ax.set_xlim(start, end)
    locator = mdates.AutoDateLocator()
    ax.xaxis.set_major_locator(locator)
    ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(locator))
    _style_axes(ax)
