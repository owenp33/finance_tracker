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
from matplotlib.ticker import FuncFormatter, MaxNLocator
from matplotlib.transforms import blended_transform_factory
from services.reports.summary_data import VENDOR_LIMIT, round_half_up

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
CHART_BLUE = '#2a78d6'        # balances, spending by category
CHART_AQUA = '#1baf7a'        # more in than out
CHART_ORANGE = '#eb6834'      # more out than in
PARTIAL_ALPHA = 0.35          # a month only partly in the period
OVER_BUDGET_WASH = '#f9e1e1'


def render_summary_page(pdf, analytics, period_label, generated_label, income=None):
    """
    The totals and averages (AnalyticsService.generate_report), with income by category as one
    line under them, as on the app's Insights Overview (`income`: summary_data.largest_income;
    no line without income).
    """
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
        *([(_income_line(income), 12, 'normal')] if income else []),
        (f"Transactions: {summary['transaction_count']}", 12, 'normal'),
        (f"Average Transaction: ${summary['avg_transaction']:,.2f}", 12, 'normal'),
        ('', 12, 'normal'),
        (f"Avg Weekly Income: ${trends['weekly_avg_income']:,.2f}", 12, 'normal'),
        (f"Avg Weekly Expenses: ${trends['weekly_avg_expenses']:,.2f}", 12, 'normal'),
    ]

    y = 0.95
    for text, size, weight in lines:
        ax.text(0.05, y, text, fontsize=size, fontweight=weight, transform=ax.transAxes, parse_math=False)
        y -= 0.05 if size <= 12 else 0.07

    pdf.savefig(fig)
    plt.close(fig)


def _income_line(income):
    """'Largest income category: Paycheck, $4,000.00 of $4,050.00 (99%)', or the one category."""
    category = _shorten(income['category'], PANEL_CATEGORY_CHARS)
    if income['categories'] == 1:
        return f"All income is in one category: {category} ({_money(income['total'])})"
    share = round_half_up(income['cents'] / income['total'] * 100)
    return (f"Largest income category: {category}, {_money(income['cents'])} of "
            f"{_money(income['total'])} ({share}%)")


# NET PER MONTH =================================================================
# As on the app's Insights Overview (Phase V, V5c)

NET_TITLE = 'Net per month'
NET_NOTE = ('Money in minus money out each month, transfers left out; '
            'a month only partly in the period is lighter and in no average.')
AVERAGE_LABEL = '3-month average of each month and the months either side'
NET_COLUMNS = [               # (header, share of the table width, alignment)
    ('Month', 0.28, 'left'), ('Money in', 0.18, 'right'), ('Money out', 0.18, 'right'),
    ('Net', 0.18, 'right'), ('3-month average', 0.18, 'right'),
]
MIN_MONTH_SLOTS = 6           # a few months still get bars this narrow, centred
# Months between labels, smallest first, as the app's utils/monthTicks.js: every 1, 2, 3 or 6 months
# on the calendar (every 3: Jan, Apr, Jul, Oct), then every January, then every 2, 3, 5 or 10 years
MONTH_STEPS = (1, 2, 3, 6, 12, 24, 36, 60, 120)
NET_LABEL_SLOTS = (50, 32)    # points a label needs on the net chart (8pt), gap included: "Sep 2026", "2026"


def render_net_per_month_pages(pdf, rows, period_label):
    """
    Net per month: bars around $0 (aqua above, orange below; a month only partly in the period
    lighter) with the 3-month average as a line, each point on the middle month of the three, then
    the numbers as a table, on as many pages as it needs. `rows` are summary_data.monthly_net's.
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
    colors = [to_rgba(CHART_ORANGE if row['net'] < 0 else CHART_AQUA, PARTIAL_ALPHA if row['partial'] else 1)
              for row in rows]
    ax.bar(x, [row['net'] / 100 for row in rows], width=0.7, color=colors, zorder=2)
    ax.axhline(0, color=BASELINE, linewidth=1, zorder=1)
    ax.plot(x, [nan if row['average'] is None else row['average'] / 100 for row in rows],
            color=INK, linewidth=2, marker='o', markersize=3, label=AVERAGE_LABEL, zorder=3)

    _month_xlim(ax, len(rows))
    positions, labels = _month_ticks([row['month'] for row in rows], _axis_points(ax), NET_LABEL_SLOTS)
    ax.set_xticks(positions, labels=labels)
    _style_axes(ax)
    ax.spines['bottom'].set_visible(False)   # the $0 line is the baseline
    ax.tick_params(axis='x', length=0)
    ax.legend(handles=[
        Patch(color=CHART_AQUA, label='More in than out'),
        Patch(color=CHART_ORANGE, label='More out than in'),
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


def _on_step(month, step):
    """Whether a month ('YYYY-MM') is labelled when labels are `step` months apart."""
    year, number = map(int, month.split('-'))
    return (number - 1) % step == 0 if step < 12 else number == 1 and year % (step // 12) == 0


def _month_ticks(months, width, slots, year_below=False):
    """
    Where and how to label a run of months ('YYYY-MM') on an axis `width` points wide, by the app's
    rule (utils/monthTicks.js monthAxis): the smallest of MONTH_STEPS whose labels fit, `slots` being
    the points a month label and a year label need, so labels are evenly spaced and never crowd. The
    year shows on the first label and on January (on a line of its own under the month for a narrow
    chart), and alone once labels are a year or more apart.
    """
    def fits(step):
        room = max(1, int(width // slots[0 if step < 12 else 1]))
        return sum(_on_step(month, step) for month in months) <= room

    step = next((step for step in MONTH_STEPS if fits(step)), MONTH_STEPS[-1])
    shown = [i for i, month in enumerate(months) if _on_step(month, step)] or list(range(min(len(months), 1)))
    if step >= 12:
        return shown, [months[i][:4] for i in shown]
    labels = [_month_label(months[i], with_year=n == 0 or months[i].endswith('-01')) for n, i in enumerate(shown)]
    return shown, [label.replace(' ', '\n') for label in labels] if year_below else labels


def _axis_points(ax):
    """How wide an axes is on its page, in points."""
    return ax.get_position().width * ax.figure.get_figwidth() * 72


def _month_xlim(ax, count):
    """Room for `count` months, centred: a few months still get bars no wider than MIN_MONTH_SLOTS allow."""
    pad = max(0.6, (MIN_MONTH_SLOTS - count) / 2 + 0.6)
    ax.set_xlim(-pad, count - 1 + pad)


# SPENDING BY CATEGORY ==========================================================
# As on the app's Insights Overview (Phase V, V5b): small multiples, three to a row

SPENDING_TITLE = 'Spending by category'
SPENDING_NOTE = ('Per month, each on its own scale; the dashed line is its monthly average, '
                 'and a month only partly in the period is lighter.')
NO_SPENDING = 'No spending in this period.'
AVERAGE_LINE_LABEL = 'Monthly average'
PANELS_PER_ROW = 3            # summary_data.PANEL_LIMIT (8, Other included) fill three rows
PANEL_WIDTH = 0.26            # as fractions of the page
PANEL_GAP = 0.05
PANEL_AXIS_ROOM = 0.045       # for the dollar ticks, left of each chart
PANEL_TOP = 0.87              # the first row's caption
PANEL_ROW_HEIGHT = 0.165      # a caption, its chart and month ticks
PANEL_CAPTION_LINE = 0.015
PANEL_CHART_HEIGHT = 0.095    # under the caption's two lines
SPENDING_TABLE_TOP = 0.36
PANEL_LABEL_SLOTS = (28, 28)  # points a label needs on a panel (7pt, the year under the month), gap included
PANEL_CATEGORY_CHARS = 30     # longer text is cut short with an ellipsis


def render_spending_by_category_page(pdf, panels, period_label):
    """
    Spending by category: a small chart per panel (summary_data.category_panels: 8 at most, the
    top 7 then Other), each a bar per month on its own scale (a month only partly in the period lighter)
    with its monthly average dashed and its last full month against that average above it, then
    the numbers as a table.
    """
    fig = plt.figure(figsize=(8.5, 11))
    _page_header(fig, SPENDING_TITLE, period_label, SPENDING_NOTE)
    if panels:
        for i, panel in enumerate(panels):
            _category_panel(fig, panel, *divmod(i, PANELS_PER_ROW))
        last_month = next((panel['last']['month'] for panel in panels if panel['last']), None)
        _table(fig, _spending_columns(last_month), [(_spending_cells(panel), False) for panel in panels],
               SPENDING_TABLE_TOP)
    else:
        fig.text(0.06, PANEL_TOP, NO_SPENDING, fontsize=10, color=INK_SECONDARY, va='top')
    pdf.savefig(fig)
    plt.close(fig)


def _category_panel(fig, panel, row, column):
    """One panel: its category and its label, over its chart."""
    left = 0.06 + column * (PANEL_WIDTH + PANEL_GAP)
    top = PANEL_TOP - row * PANEL_ROW_HEIGHT
    chart_top = top - 2 * PANEL_CAPTION_LINE - 0.005
    ax = fig.add_axes([left + PANEL_AXIS_ROOM, chart_top - PANEL_CHART_HEIGHT,
                       PANEL_WIDTH - PANEL_AXIS_ROOM, PANEL_CHART_HEIGHT])

    caption = [(_shorten(panel['category'], PANEL_CATEGORY_CHARS), 9, 'bold', INK),
               (_panel_label(panel), 7.5, 'normal', INK_SECONDARY)]
    for line, (text, size, weight, color) in enumerate(caption):
        ax.text(left, top - line * PANEL_CAPTION_LINE, text, transform=fig.transFigure, va='top',
                fontsize=size, fontweight=weight, color=color, parse_math=False)

    months = panel['months']
    ax.bar(range(len(months)), [m['cents'] / 100 for m in months], width=0.8, zorder=2,
           color=[to_rgba(CHART_BLUE, PARTIAL_ALPHA if m['partial'] else 1) for m in months])
    if panel['average'] is not None:
        ax.axhline(panel['average'] / 100, color=INK, linewidth=1, dashes=(4, 3), zorder=3,
                   label=AVERAGE_LINE_LABEL)
    _month_xlim(ax, len(months))
    positions, labels = _month_ticks([m['month'] for m in months], _axis_points(ax), PANEL_LABEL_SLOTS,
                                     year_below=True)
    ax.set_xticks(positions, labels=labels)
    ax.yaxis.set_major_locator(MaxNLocator(nbins=2))
    _style_axes(ax)
    ax.tick_params(axis='x', length=0)
    ax.tick_params(labelsize=7)


def _panel_label(panel):
    """Its last full month against its average, in whole dollars: 'Oct: $350, 8% above its $325 average'."""
    average, last = panel['average'], panel['last']
    if last is None or average is None:
        return 'No full month yet'
    month, amount = _month_label(last['month'], with_year=False), _whole_dollars(last['cents'])
    if average == 0:
        return f'{month}: {amount}'
    typical = _whole_dollars(average)
    percent = round_half_up((last['cents'] - average) / average * 100)
    if abs(percent) < 5:
        return f'{month}: {amount}, about its {typical} average'
    return f"{month}: {amount}, {abs(percent)}% {'above' if percent > 0 else 'below'} its {typical} average"


def _spending_columns(last_month):
    """The table's columns, naming the last full month when there is one."""
    last = f'Last full month ({_month_label(last_month)})' if last_month else 'Last full month'
    return [('Category', 0.28, 'left'), ('Total', 0.15, 'right'), ('Monthly average', 0.17, 'right'),
            (last, 0.27, 'right'), ('Transactions', 0.13, 'right')]


def _spending_cells(panel):
    """A table row: category, total, monthly average, last full month, transactions."""
    return [
        _shorten(panel['category'], PANEL_CATEGORY_CHARS), _money(panel['total']),
        '—' if panel['average'] is None else _money(panel['average']),
        '—' if panel['last'] is None else _money(panel['last']['cents']),
        str(panel['count']),
    ]


# TOP VENDORS ===================================================================
# As on the app's Insights Overview (Phase V, V5d)

VENDORS_TITLE = 'Top vendors'
VENDORS_NOTE = f'The vendors you spent the most with (up to {VENDOR_LIMIT}), transfers left out.'
VENDOR_COLUMNS = [            # (header, share of the table width, alignment)
    ('Vendor', 0.43, 'left'), ('Total', 0.19, 'right'), ('Charges', 0.15, 'right'),
    ('Average charge', 0.23, 'right'),
]
VENDOR_CHART_TOP = 0.87       # as fractions of the page
VENDOR_BARS_RIGHT = 0.80      # the largest bar ends here; the totals end at the page margin


def render_top_vendors_page(pdf, vendors, period_label):
    """
    Top vendors: a bar per vendor (summary_data.top_vendors), largest first, its name on the left
    and its total in an aligned column at the end, then the numbers as a table.
    """
    fig = plt.figure(figsize=(8.5, 11))
    _page_header(fig, VENDORS_TITLE, period_label, VENDORS_NOTE)
    if vendors:
        bars = [(_shorten(v['vendor'], VENDOR_CHARS), v['total'], _money(v['total']), False) for v in vendors]
        chart_bottom = _labelled_bars(fig, bars, VENDOR_CHART_TOP, VENDOR_BARS_RIGHT)
        _table(fig, VENDOR_COLUMNS, [(_vendor_cells(vendor), False) for vendor in vendors],
               chart_bottom - BAR_TABLE_GAP)
    else:
        fig.text(0.06, VENDOR_CHART_TOP, NO_SPENDING, fontsize=10, color=INK_SECONDARY, va='top')
    pdf.savefig(fig)
    plt.close(fig)


def _vendor_cells(vendor):
    """A table row: vendor, total, charges, average charge."""
    return [_shorten(vendor['vendor'], VENDOR_CHARS), _money(vendor['total']), str(vendor['count']),
            _money(vendor['average'])]


# RECURRING COSTS ===============================================================
# As on the app's Insights → Recurring (Phase V, V3a): the series as they stand today

RECURRING_TITLE = 'Recurring costs'
RECURRING_NOTE = ('Each series at its scheduled amount per month (weekly and biweekly ones converted to a month); '
                  'ended series are lighter.')
RECURRING_BARS_HEADING = 'Cost per month, by series'
BEYOND_MIN_CENTS = 100        # paying beyond a schedule is worth a note from a dollar up
FREQUENCY_LABELS = {          # the app's five schedules; others read "every N days / months"
    (7, 'days'): 'Weekly', (14, 'days'): 'Biweekly', (1, 'months'): 'Monthly',
    (3, 'months'): 'Quarterly', (12, 'months'): 'Annually',
}
RECURRING_COLUMNS = [         # (header, share of the table width, alignment)
    ('Series', 0.21, 'left'), ('Account', 0.16, 'left'), ('Charged', 0.17, 'left'),
    ('Per month', 0.11, 'right'), ('Status', 0.14, 'left'), ('Paid beyond schedule', 0.21, 'right'),
]
RECURRING_BARS_RIGHT = 0.66   # room for "$652.50/mo · ended Aug 2026" at the page margin
SERIES_CHARS = 24             # longer text is cut short with an ellipsis
ACCOUNT_CHARS = 18


def render_recurring_costs_page(pdf, costs, account_names, as_of):
    """
    Recurring costs as of `as_of` (today, whatever the report's period): the active series' cost
    per month, a note for each that paid beyond its schedule (never added in), a bar per series
    (active first, ended lighter and labelled), then the table, continued on more pages when long.
    `costs` is summary_data.recurring_costs' and has series; `account_names` maps account ids to
    names.
    """
    rows = [_recurring_row(series, account_names) for series in costs['series']]
    fig = plt.figure(figsize=(8.5, 11))
    _page_header(fig, RECURRING_TITLE, f"As of {as_of.isoformat()} (not limited to the report's period)",
                 RECURRING_NOTE)
    top = _recurring_headline(fig, costs, rows)
    fig.text(0.06, top, RECURRING_BARS_HEADING, fontsize=11, fontweight='bold', color=INK, va='top')
    bars = [(row['name'], row['monthly'], row['bar_label'], not row['active']) for row in rows]
    table_top = _labelled_bars(fig, bars, top - 0.03, RECURRING_BARS_RIGHT) - BAR_TABLE_GAP
    first_rows = max(1, int((table_top - PAGE_BOTTOM) / ROW_HEIGHT) - 1)   # the header takes a row
    for number, chunk in enumerate(page_chunks([(row['cells'], False) for row in rows], first=first_rows)):
        if number > 0:
            pdf.savefig(fig)
            plt.close(fig)
            fig = plt.figure(figsize=(8.5, 11))
            _continued_header(fig, RECURRING_TITLE)
            table_top = CONTINUED_TABLE_TOP
        _table(fig, RECURRING_COLUMNS, chunk, table_top)
    pdf.savefig(fig)
    plt.close(fig)


def _recurring_headline(fig, costs, rows):
    """The active series' total per month and the notes on it; returns where the page goes on."""
    y = 0.875
    if costs['active_count']:
        fig.text(0.06, y, f"{_money(costs['total'])}/mo", fontsize=20, fontweight='bold', color=INK, va='top',
                 parse_math=False)
        y -= 0.035
        income = "; income isn't counted" if costs['income_count'] else ''
        fig.text(0.06, y, f"{costs['active_count']} active series at their scheduled amounts{income}",
                 fontsize=10, color=INK_SECONDARY, va='top')
    else:
        fig.text(0.06, y, 'No active recurring costs', fontsize=10, color=INK_SECONDARY, va='top')
    y -= 0.022
    for row in rows:
        if row['note']:
            fig.text(0.06, y, row['note'], fontsize=9, color=INK_SECONDARY, va='top', parse_math=False)
            y -= 0.016
    return y - 0.025


def _recurring_row(series, account_names):
    """One series' bar, note and table cells, worded as the app words them."""
    template = series['template']
    beyond = series['beyond'] if series['beyond'] and series['beyond']['extra'] >= BEYOND_MIN_CENTS else None
    ended = f" {_month_label(series['ended'])}" if series['ended'] else ''
    monthly = _money(series['monthly'])
    charged = f"{_money(abs(template.amount_cents))} {_frequency_label(template.frequency, template.frequency_unit).lower()}"
    beyond_range = beyond and _month_range_label(beyond['from'], beyond['to'])
    return {
        'name': _shorten(template.vendor, VENDOR_CHARS),
        'monthly': series['monthly'],
        'active': series['active'],
        'bar_label': f'{monthly}/mo' + ('' if series['active'] else f' · ended{ended}'),
        'note': beyond and (f"Not included: {_whole_dollars(beyond['extra'])} paid to {template.vendor} beyond its "
                            f'{monthly}/mo schedule in {beyond_range}'),
        'cells': [
            _shorten(template.vendor, SERIES_CHARS), _shorten(account_names.get(template.account_id, ''), ACCOUNT_CHARS),
            charged, monthly, 'Active' if series['active'] else f'Ended{ended}',
            f"{_whole_dollars(beyond['extra'])} in {beyond_range}" if beyond else '—',
        ],
    }


def _frequency_label(frequency, unit):
    """'Biweekly', or 'Every 30 days' for a schedule that isn't one of the app's five."""
    if (frequency, unit) in FREQUENCY_LABELS:
        return FREQUENCY_LABELS[frequency, unit]
    return f"Every {frequency} {'month' if unit == 'months' else 'day'}{'' if frequency == 1 else 's'}"


def _month_range_label(start, end):
    """'Nov 2025–Oct 2026', 'Apr–Oct 2026', or 'Sep 2026' for one month."""
    if start == end:
        return _month_label(end)
    return f'{_month_label(start, with_year=start[:4] != end[:4])}–{_month_label(end)}'


# SHARED PIECES =================================================================

def _money(cents):
    """-$1,234.50 / $1,234.50"""
    return f"{'-' if cents < 0 else ''}${abs(cents) / 100:,.2f}"


def _signed_money(cents):
    """+$1,234.50 / -$1,234.50 / $0.00"""
    return f"{'+' if cents > 0 else ''}{_money(cents)}"


def _whole_dollars(cents):
    """$1,235: an estimate, rounded half away from zero as the app's formatWholeDollars does."""
    return f"{'-' if cents < 0 else ''}${(abs(cents) + 50) // 100:,}"


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


def page_chunks(rows, first=FIRST_PAGE_ROWS):
    """A table's rows split into pages: `first` under the page's chart, then CONTINUED_ROWS a page."""
    rest = range(first, len(rows), CONTINUED_ROWS)
    return [rows[:first]] + [rows[i:i + CONTINUED_ROWS] for i in rest]


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


BAR_ROW_HEIGHT = 0.03         # one bar's row, as a fraction of the page
BARS_MAX_HEIGHT = 0.36        # more bars than fit get thinner rows
BAR_NAMES_RIGHT = 0.36        # the names end here, the bars start
BAR_TABLE_GAP = 0.05          # between the bars and a table under them
PAGE_BOTTOM = 0.06            # tables stop above this


def _labelled_bars(fig, bars, top, bars_right):
    """
    Horizontal bars hanging down from `top`, the first on top: `bars` are (name, cents, label,
    lighter?). The largest reaches `bars_right`; names sit on the left and labels in an aligned
    column at the page margin, with no axes. Returns where the bars end.
    """
    bottom = top - min(BAR_ROW_HEIGHT, BARS_MAX_HEIGHT / len(bars)) * len(bars)
    ax = fig.add_axes([BAR_NAMES_RIGHT, bottom, bars_right - BAR_NAMES_RIGHT, top - bottom])
    rows = range(len(bars))
    ax.barh(rows, [cents / 100 for _, cents, _, _ in bars], height=0.6,
            color=[to_rgba(CHART_BLUE, PARTIAL_ALPHA if lighter else 1) for *_, lighter in bars])
    ax.set_yticks(rows, labels=[name for name, *_ in bars], parse_math=False)
    ax.set_ylim(len(bars) - 0.5, -0.5)
    ax.set_xlim(0, max(cents for _, cents, _, _ in bars) / 100 or 1)
    at_page_margin = blended_transform_factory(fig.transFigure, ax.transData)
    for row, (_, _, label, _) in zip(rows, bars):
        ax.text(0.94, row, label, transform=at_page_margin, ha='right', va='center', fontsize=8.5, color=INK,
                parse_math=False)
    ax.xaxis.set_visible(False)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.tick_params(axis='y', length=0, labelsize=8.5, labelcolor=INK)
    return bottom


# ACCOUNT PAGES =================================================================

def account_table_rows(rows, over_budget_ids):
    """
    (cells, over budget?) for each ledger row, one cell per ACCOUNT_COLUMNS entry. A loan's payment
    (made from another account) shows the amount on the loan, and its budget flag only on its own
    account's page; an interest hit reads "Interest" and is never over budget.
    """
    table = []
    for row in rows:
        t = row.transaction
        over = row.own_transaction and t.id in over_budget_ids
        table.append(([
            t.date.isoformat(),
            _shorten(t.vendor, VENDOR_CHARS),
            _shorten(t.category, CATEGORY_CHARS),
            _money(row.amount_cents),
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
    ax.step(dates, balances, where='post', color=CHART_BLUE, linewidth=2,
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
