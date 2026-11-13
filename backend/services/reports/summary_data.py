"""
summary_data.py - The numbers behind the PDF report's summary pages, in cents

Counted as the app's Insights counts them (frontend `utils/moneyRules.js` and
`components/insights/`): transfers never count, money in is income (reimbursements included),
money out is spending, and a zero amount is neither. Pure functions over transactions; months
are 'YYYY-MM' strings.
"""
import calendar
import math

PANEL_LIMIT = 8   # categories with a chart of their own; the rest add up as Other


def round_half_up(value):
    """Rounds as JavaScript's Math.round does (halves up), so the numbers match the app's."""
    return math.floor(value + 0.5)


def _is_income(t):
    return not t.is_transfer and t.amount_cents > 0


def _is_spending(t):
    return not t.is_transfer and t.amount_cents < 0


def _month(day):
    return day.strftime('%Y-%m')


def _months_from(first, last):
    """Every month from `first` through `last` (dates), in order."""
    months, year, month = [], first.year, first.month
    while (year, month) <= (last.year, last.month):
        months.append(f'{year}-{month:02d}')
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def period_months(transactions, chosen_start, chosen_end, today):
    """
    The months a report covers, in order, and those it only partly covers (a pair of lists).
    `transactions` are the report's, by date (at least one). The period runs from the chosen
    start (else the first transaction) to the chosen end (else the last transaction), but stops
    at today's month, or a later transaction's: a month still to come holds nothing yet. Partial:
    a chosen start after its month's 1st, a chosen end before its month's last day, and today's
    month and any after it, which are still going or still to come.
    """
    first, last = transactions[0].date, transactions[-1].date
    start = chosen_start or first
    end = min(chosen_end or last, max(today, last))
    months = _months_from(start, end)

    partial = set()
    if chosen_start and chosen_start.day != 1:
        partial.add(_month(chosen_start))
    if chosen_end and chosen_end.day < calendar.monthrange(chosen_end.year, chosen_end.month)[1]:
        partial.add(_month(chosen_end))
    partial.update(month for month in months if month >= _month(today))
    return months, [month for month in months if month in partial]


def monthly_net(transactions, months, partial):
    """
    Net per month as the app's Insights Overview draws it: for each of `months`, a dict with its
    `income` and `expenses` (money in and out, positive), `net`, whether it's `partial`, and the
    3-month moving `average` of net: each full month with the two full months before it, so it
    starts at the third full month and partial months are in no average (else None).
    """
    totals = {month: {'income': 0, 'expenses': 0} for month in months}
    for t in transactions:
        month = totals.get(_month(t.date))
        if month is None:
            continue
        if _is_income(t):
            month['income'] += t.amount_cents
        elif _is_spending(t):
            month['expenses'] -= t.amount_cents

    part_only = set(partial)
    rows = [{
        'month': month,
        'income': totals[month]['income'],
        'expenses': totals[month]['expenses'],
        'net': totals[month]['income'] - totals[month]['expenses'],
        'partial': month in part_only,
        'average': None,
    } for month in months]
    full = [row for row in rows if not row['partial']]
    for i in range(2, len(full)):
        full[i]['average'] = round_half_up((full[i]['net'] + full[i - 1]['net'] + full[i - 2]['net']) / 3)
    return rows


def category_panels(transactions, months, partial, limit=PANEL_LIMIT):
    """
    Spending by category as the app's Insights Overview draws it (small multiples): a panel per
    category with spending in `months`, the top `limit` by total, then the rest added up as Other
    (which names them in `others`). Each: {category, total, count (spending transactions), months:
    [{month, cents, partial}], average (over the full months; None without one), last (the last
    full month's {month, cents}, or None)}. Plain spending: reimbursements aren't taken off, since
    only budgets do that.
    """
    in_period = set(months)
    categories = {}
    for t in transactions:
        month = _month(t.date)
        if not _is_spending(t) or month not in in_period:
            continue
        category = categories.setdefault(t.category, {'by_month': {}, 'count': 0})
        category['by_month'][month] = category['by_month'].get(month, 0) - t.amount_cents
        category['count'] += 1

    ranked = sorted(
        ({'category': name, 'total': sum(c['by_month'].values()), **c} for name, c in categories.items()),
        key=lambda c: (-c['total'], c['category'].casefold()))
    groups = [(c['category'], [c], None) for c in ranked[:limit]]
    rest = ranked[limit:]
    if rest:
        groups.append(('Other', rest, sorted(c['category'] for c in rest)))

    part_only = set(partial)
    panels = []
    for name, members, others in groups:
        panel_months = [{
            'month': month,
            'cents': sum(c['by_month'].get(month, 0) for c in members),
            'partial': month in part_only,
        } for month in months]
        full = [m for m in panel_months if not m['partial']]
        panel = {'category': name, **({'others': others} if others else {})}
        panel.update({
            'total': sum(c['total'] for c in members),
            'count': sum(c['count'] for c in members),
            'months': panel_months,
            'average': round_half_up(sum(m['cents'] for m in full) / len(full)) if full else None,
            'last': {'month': full[-1]['month'], 'cents': full[-1]['cents']} if full else None,
        })
        panels.append(panel)
    return panels


def largest_income(transactions):
    """
    Income by category, as the one line the app's Insights Overview gives it: the largest income
    category's `category` and `cents`, all money in (`total`), and how many `categories` it came
    from. None without money in.
    """
    categories = {}
    for t in transactions:
        if _is_income(t):
            categories[t.category] = categories.get(t.category, 0) + t.amount_cents
    if not categories:
        return None
    category, cents = min(categories.items(), key=lambda item: (-item[1], item[0].casefold()))
    return {'category': category, 'cents': cents, 'total': sum(categories.values()), 'categories': len(categories)}
