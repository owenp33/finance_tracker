"""
The numbers behind the PDF's summary pages (services/reports/summary_data.py), counted as the
app's Insights counts them: transfers never count, money in is income (reimbursements included),
money out is spending, and a zero amount is neither.
"""
from datetime import date
from types import SimpleNamespace

from services.reports import summary_data

TODAY = date(2026, 11, 12)


def tx(day, cents, transfer=False, reimbursement=False, category='Misc', vendor='Shop'):
    return SimpleNamespace(date=day, amount_cents=cents, is_transfer=transfer, is_reimbursement=reimbursement,
                           category=category, vendor=vendor)


def spend(day, category, dollars):
    return tx(day, -dollars * 100, category=category)


# Sep and Oct 2026 and November so far: ten spending categories, two paychecks, a Groceries
# reimbursement and a transfer (as in the app's categoryPanels tests)
SPENDING = [
    tx(date(2026, 9, 1), 200000, category='Paycheck'), tx(date(2026, 10, 1), 200000, category='Paycheck'),
    spend(date(2026, 9, 3), 'Rent', 900), spend(date(2026, 10, 3), 'Rent', 900), spend(date(2026, 11, 3), 'Rent', 900),
    spend(date(2026, 9, 10), 'Groceries', 300), spend(date(2026, 10, 10), 'Groceries', 400),
    spend(date(2026, 11, 5), 'Groceries', 100),
    tx(date(2026, 10, 15), 5000, reimbursement=True, category='Groceries'),
    spend(date(2026, 9, 12), 'Gas', 100), spend(date(2026, 10, 12), 'Gas', 140),
    spend(date(2026, 9, 14), 'Dining', 60), spend(date(2026, 10, 14), 'Dining', 40),
    spend(date(2026, 9, 20), 'Fun', 50), spend(date(2026, 10, 20), 'Fun', 80),
    spend(date(2026, 9, 21), 'Subscriptions', 20), spend(date(2026, 10, 21), 'Subscriptions', 20),
    spend(date(2026, 9, 22), 'Medical', 87),
    spend(date(2026, 10, 23), 'Shopping', 30),
    spend(date(2026, 10, 24), 'Gifts', 25),
    spend(date(2026, 9, 25), 'Pets', 15),
    tx(date(2026, 10, 26), -50000, transfer=True, category='Transfer'),
]


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


class TestCategoryPanels:
    """Spending by category as the app's small multiples: the top 8, then Other."""

    def panels(self):
        return summary_data.category_panels(SPENDING, ['2026-09', '2026-10', '2026-11'], ['2026-11'])

    def test_the_top_8_categories_by_plain_spending_then_the_rest_as_other(self):
        assert [(p['category'], p['total'], p['count']) for p in self.panels()] == [
            ('Rent', 270000, 3), ('Groceries', 80000, 3), ('Gas', 24000, 2), ('Fun', 13000, 2),
            ('Dining', 10000, 2), ('Medical', 8700, 1), ('Subscriptions', 4000, 2), ('Shopping', 3000, 1),
            ('Other', 4000, 2),
        ]

    def test_each_panel_has_every_month_its_average_over_the_full_months_and_its_last_full_month(self):
        panels = self.panels()
        groceries, medical = panels[1], panels[5]
        assert groceries['months'] == [
            {'month': '2026-09', 'cents': 30000, 'partial': False},
            {'month': '2026-10', 'cents': 40000, 'partial': False},
            {'month': '2026-11', 'cents': 10000, 'partial': True},
        ]
        assert (groceries['average'], groceries['last']) == (35000, {'month': '2026-10', 'cents': 40000})
        assert ([m['cents'] for m in medical['months']], medical['average']) == ([8700, 0, 0], 4350)

    def test_other_adds_up_the_rest_month_by_month_and_names_them(self):
        other = self.panels()[8]
        assert (other['others'], [m['cents'] for m in other['months']]) == (['Gifts', 'Pets'], [1500, 2500, 0])
        assert 'others' not in self.panels()[0]

    def test_without_a_full_month_there_is_no_average_or_last_month(self):
        (rent,) = summary_data.category_panels([spend(date(2026, 11, 3), 'Rent', 900)], ['2026-11'], ['2026-11'])
        assert (rent['average'], rent['last']) == (None, None)

    def test_an_average_on_a_half_cent_rounds_up_as_the_app_does(self):
        txs = [tx(date(2026, 9, 1), -30000, category='Rent'), tx(date(2026, 10, 1), -30001, category='Rent')]
        (rent,) = summary_data.category_panels(txs, ['2026-09', '2026-10'], [])
        assert rent['average'] == 30001

    def test_no_spending_no_panels(self):
        txs = [tx(date(2026, 10, 1), 200000, category='Paycheck'),
               tx(date(2026, 10, 2), -500, transfer=True, category='Transfer')]
        assert summary_data.category_panels(txs, ['2026-10'], []) == []


class TestLargestIncome:
    """Income by category as one line: its largest category, against all money in."""

    def test_the_largest_income_category_and_all_money_in(self):
        txs = [
            tx(date(2026, 10, 1), 400000, category='Paycheck'),
            tx(date(2026, 10, 15), 5000, reimbursement=True, category='Groceries'),   # money in like any other
            tx(date(2026, 10, 20), 50000, transfer=True, category='Transfer'),        # never counts
            tx(date(2026, 10, 21), -1000, category='Fun'),
        ]
        assert summary_data.largest_income(txs) == {
            'category': 'Paycheck', 'cents': 400000, 'total': 405000, 'categories': 2}

    def test_no_money_in_nothing_to_say(self):
        assert summary_data.largest_income([tx(date(2026, 10, 21), -1000, category='Fun')]) is None


class TestTopVendors:
    """The vendors spent with most, as the app's Insights Overview lists them."""

    def test_the_vendors_spent_with_most_with_their_charges_and_average_charge(self):
        txs = [
            tx(date(2026, 10, 3), -90000, vendor='Rent Co'),
            tx(date(2026, 10, 4), -1000, vendor='Target'), tx(date(2026, 10, 9), -2000, vendor='Target'),
            tx(date(2026, 10, 20), -3001, vendor='Target'),
            tx(date(2026, 10, 21), 500, reimbursement=True, vendor='Target'),   # money in isn't spending
            tx(date(2026, 10, 22), -50000, transfer=True, vendor='To savings'),  # never counts
            tx(date(2026, 10, 23), -1000, vendor='Zinc'), tx(date(2026, 10, 24), -1000, vendor='apple'),
        ]
        assert summary_data.top_vendors(txs) == [
            {'vendor': 'Rent Co', 'total': 90000, 'count': 1, 'average': 90000},
            {'vendor': 'Target', 'total': 6001, 'count': 3, 'average': 2000},
            {'vendor': 'apple', 'total': 1000, 'count': 1, 'average': 1000},   # ties by name
            {'vendor': 'Zinc', 'total': 1000, 'count': 1, 'average': 1000},
        ]

    def test_only_the_top_10(self):
        txs = [tx(date(2026, 10, 1), -100 * (i + 1), vendor=f'Vendor {i:02d}') for i in range(12)]
        vendors = summary_data.top_vendors(txs)
        assert (len(vendors), vendors[0]['vendor'], vendors[-1]['vendor']) == (10, 'Vendor 11', 'Vendor 02')

    def test_an_average_charge_on_a_half_cent_rounds_up_as_the_app_does(self):
        txs = [tx(date(2026, 10, 1), -1, vendor='Gum'), tx(date(2026, 10, 2), -2, vendor='Gum')]
        assert summary_data.top_vendors(txs)[0]['average'] == 2

    def test_no_spending_no_vendors(self):
        assert summary_data.top_vendors([tx(date(2026, 10, 1), 200000, vendor='Employer')]) == []

