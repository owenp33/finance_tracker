"""
summary_data.py - The numbers behind the PDF report's summary pages, in cents

Counted as the app's Insights counts them (frontend `utils/moneyRules.js` and
`components/insights/`): transfers and a loan account's transactions never count, money in is
income (reimbursements included), money out is spending, and a zero amount is neither. Pure
functions over transactions; months are 'YYYY-MM' strings.
"""
import calendar
import math
from datetime import date
from models.recurring import shift_date

PANEL_LIMIT = 8    # categories with a chart of their own; the rest add up as Other
VENDOR_LIMIT = 10  # vendors on the top vendors page


def round_half_up(value):
    """Rounds as JavaScript's Math.round does (halves up), so the numbers match the app's."""
    return math.floor(value + 0.5)


def _counts(t):
    return not t.is_transfer and not t.on_loan_account


def _is_income(t):
    return _counts(t) and t.amount_cents > 0


def _is_spending(t):
    return _counts(t) and t.amount_cents < 0


def _month(day):
    return day.strftime('%Y-%m')


def _shift_month(month, months):
    """The month `months` after 'YYYY-MM' (negative goes back)."""
    year, number = map(int, month.split('-'))
    total = year * 12 + number - 1 + months
    return f'{total // 12}-{total % 12 + 1:02d}'


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
    3-month `average` of net on the middle month: each month's with the months either side, when
    all three are full (else None), so the first and last month have none and partial months are
    in no average.
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
    for i in range(1, len(rows) - 1):
        three = rows[i - 1:i + 2]
        if not any(row['partial'] for row in three):
            rows[i]['average'] = round_half_up(sum(row['net'] for row in three) / 3)
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


def top_vendors(transactions, limit=VENDOR_LIMIT):
    """
    The vendors spent with most, as the app's Insights Overview lists them with every charge (its
    "leave out recurring charges" toggle has no paper form): {vendor, total, count, average (per
    charge)}, largest first, ties by name, the top `limit`.
    """
    vendors = {}
    for t in transactions:
        if _is_spending(t):
            vendor = vendors.setdefault(t.vendor, {'vendor': t.vendor, 'total': 0, 'count': 0})
            vendor['total'] -= t.amount_cents
            vendor['count'] += 1
    ranked = sorted(vendors.values(), key=lambda v: (-v['total'], v['vendor'].casefold()))[:limit]
    return [{**v, 'average': round_half_up(v['total'] / v['count'])} for v in ranked]


def monthly_equivalent(template):
    """
    A recurring template's amount per month in cents, signed like it, as the app counts it: every
    N days repeats 364/N times a year and every N months 12/N, so weekly × 52/12, biweekly × 26/12,
    monthly × 1, quarterly ÷ 3, annually ÷ 12.
    """
    per_year = 12 / template.frequency if template.frequency_unit == 'months' else 364 / template.frequency
    cents = template.amount_cents
    return (1 if cents > 0 else -1 if cents < 0 else 0) * round_half_up(abs(cents) * per_year / 12)


def _is_finished(template):
    """A limited template is finished once every occurrence is used: it never charges again."""
    return template.number != -1 and template.idx > template.number


def _ended_month(template, payments):
    """The month a finished series ended: its last payment's, else its schedule's last occurrence's."""
    if payments:
        return _month(max(t.date for t in payments))
    if template.idx > 1:
        return _month(shift_date(template.next_date, template.frequency, template.frequency_unit, -1,
                                 template.day_of_month))
    return None


def paid_beyond_schedule(template, payments, today):
    """
    What a cost series paid beyond its schedule over the 12 full months before today's (from the
    month of its first payment, if later): its `payments` (transfers left out) as spending, against
    its cost per month for each of those months. Late, split or extra payments all simply count.
    {from, to, months, paid, scheduled, extra (never below 0)}, or None until it has a payment
    before this month.
    """
    payments = [t for t in payments if not t.is_transfer]
    if not payments:
        return None
    this_month = _month(today)
    start = max(min(_month(t.date) for t in payments), _shift_month(this_month, -12))
    end = _shift_month(this_month, -1)
    if start > end:
        return None
    months = len(_months_from(date.fromisoformat(f'{start}-01'), date.fromisoformat(f'{end}-01')))
    paid = sum(max(-t.amount_cents, 0) for t in payments if start <= _month(t.date) <= end)
    scheduled = -monthly_equivalent(template) * months
    return {'from': start, 'to': end, 'months': months, 'paid': paid, 'scheduled': scheduled,
            'extra': max(paid - scheduled, 0)}


def recurring_costs(templates, payments, today):
    """
    What the recurring series cost per month, as the app's Insights → Recurring shows it, as of
    `today`. Cost series only (income isn't a cost): each {template, active, monthly (positive),
    ended (an ended series' 'YYYY-MM'), beyond (an active one's paid_beyond_schedule)}, active
    first, then ended, each costliest first. `total` is the active series' cost per month, never
    with what they paid beyond it. `payments` are the templates' transactions, all of them.
    """
    by_series = {}
    for t in payments:
        by_series.setdefault(t.recurring_id, []).append(t)
    series = []
    for template in templates:
        if template.amount_cents >= 0:
            continue
        own = by_series.get(template.id, [])
        active = not _is_finished(template)
        series.append({
            'template': template,
            'active': active,
            'monthly': -monthly_equivalent(template),
            'ended': None if active else _ended_month(template, [t for t in own if not t.is_transfer]),
            'beyond': paid_beyond_schedule(template, own, today) if active else None,
        })
    series.sort(key=lambda s: (not s['active'], -s['monthly']))
    active = [s for s in series if s['active']]
    return {
        'series': series,
        'total': sum(s['monthly'] for s in active),
        'active_count': len(active),
        'income_count': sum(1 for template in templates if template.amount_cents > 0),
    }

