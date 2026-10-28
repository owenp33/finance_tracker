"""
pdf_pages.py - The PDF report's pages, drawn with matplotlib (one figure per page)

Each function adds one page to an open PdfPages from AnalyticsService.generate_report data.
"""
import matplotlib
matplotlib.use('Agg')   # no display: render straight to files
import matplotlib.pyplot as plt


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


def render_monthly_trends_page(pdf, analytics):
    monthly = list(reversed(analytics['monthly_summary']))

    fig, ax = plt.subplots(figsize=(11, 8.5))
    if monthly:
        months = [m['month'] for m in monthly]
        ax.plot(months, [m['income'] for m in monthly], marker='o', label='Income', color='#00C49F')
        ax.plot(months, [m['expenses'] for m in monthly], marker='o', label='Expenses', color='#FF8042')
        ax.plot(months, [m['net'] for m in monthly], marker='o', label='Net', color='#0088FE')
        ax.set_xticklabels(months, rotation=45, ha='right')
        ax.legend()
        ax.set_ylabel('Amount ($)')
    else:
        ax.text(0.5, 0.5, 'No monthly data available', ha='center', va='center', transform=ax.transAxes)
        ax.axis('off')
    ax.set_title('Monthly Trends')
    fig.tight_layout()
    pdf.savefig(fig)
    plt.close(fig)


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
