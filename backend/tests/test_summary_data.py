"""
The numbers behind the PDF's summary pages (services/reports/summary_data.py), counted as the
app's Insights counts them: transfers never count, money in is income (reimbursements included),
money out is spending, and a zero amount is neither.
"""
from datetime import date
from types import SimpleNamespace

from services.reports import summary_data

TODAY = date(2026, 11, 12)


def tx(day, cents, transfer=False, reimbursement=False):
    return SimpleNamespace(date=day, amount_cents=cents, is_transfer=transfer, is_reimbursement=reimbursement)


class TestPeriodMonths:
    """The months a report covers, and those it only partly covers."""

    def test_without_chosen_dates_it_runs_from_the_first_transaction_to_the_last_all_whole(self):
        txs = [tx(date(2025, 12, 5), -100), tx(date(2026, 2, 20), -100)]
        assert summary_data.period_months(txs, None, None, TODAY) == (['2025-12', '2026-01', '2026-02'], [])

    def test_a_chosen_start_after_the_1st_or_end_before_the_last_day_makes_its_month_partial(self):
        txs = [tx(date(2026, 2, 10), -100)]
        assert summary_data.period_months(txs, date(2026, 1, 15), date(2026, 3, 30), TODAY) == (
            ['2026-01', '2026-02', '2026-03'], ['2026-01', '2026-03'])

    def test_chosen_whole_months_are_whole(self):
        txs = [tx(date(2026, 2, 10), -100)]
        assert summary_data.period_months(txs, date(2026, 1, 1), date(2026, 2, 28), TODAY) == (
            ['2026-01', '2026-02'], [])

    def test_this_month_is_partial_and_months_still_to_come_are_left_out(self):
        txs = [tx(date(2026, 10, 3), -100)]
        assert summary_data.period_months(txs, date(2026, 10, 1), date(2026, 12, 31), TODAY) == (
            ['2026-10', '2026-11'], ['2026-11'])

    def test_a_month_ahead_with_a_transaction_in_it_stays_and_is_partial(self):
        txs = [tx(date(2026, 10, 3), -100), tx(date(2026, 12, 5), -100)]
        assert summary_data.period_months(txs, date(2026, 10, 1), date(2026, 12, 31), TODAY) == (
            ['2026-10', '2026-11', '2026-12'], ['2026-11', '2026-12'])


class TestMonthlyNet:
    """Net per month, as the app's Insights Overview draws it."""

    def test_money_in_money_out_and_net_per_month_a_month_without_any_at_0(self):
        txs = [
            tx(date(2026, 1, 1), 200000),
            tx(date(2026, 1, 9), -38940),
            tx(date(2026, 1, 15), 5000, reimbursement=True),   # money in like any other
            tx(date(2026, 1, 20), -50000, transfer=True),      # never counts
            tx(date(2026, 1, 21), 0),                          # neither
            tx(date(2026, 3, 2), -1000),
        ]
        rows = summary_data.monthly_net(txs, ['2026-01', '2026-02', '2026-03'], [])
        assert [(r['month'], r['income'], r['expenses'], r['net']) for r in rows] == [
            ('2026-01', 205000, 38940, 166060),
            ('2026-02', 0, 0, 0),
            ('2026-03', 0, 1000, -1000),
        ]

    def test_the_3_month_average_takes_each_full_month_with_the_two_full_months_before_it(self):
        # May partial (the period starts mid-month), Jun–Oct full, Nov so far:
        # net 100, then 500, -600, 300, 900, 0 (nothing in October), then -200
        txs = [
            tx(date(2026, 5, 20), 10000),
            tx(date(2026, 6, 1), 50000), tx(date(2026, 7, 1), -60000), tx(date(2026, 8, 1), 30000),
            tx(date(2026, 9, 1), 90000), tx(date(2026, 11, 3), -20000),
        ]
        months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']
        rows = summary_data.monthly_net(txs, months, ['2026-05', '2026-11'])
        assert [(r['net'], r['partial'], r['average']) for r in rows] == [
            (10000, True, None),
            (50000, False, None), (-60000, False, None), (30000, False, 6667),
            (90000, False, 20000), (0, False, 40000),
            (-20000, True, None),
        ]
