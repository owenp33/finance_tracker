import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timedelta
import matplotlib.pyplot as plt
import seaborn as sns

# Set page config
st.set_page_config(
    page_title="Financial Dashboard",
    page_icon="💰",
    layout="wide",
    initial_sidebar_state="expanded"
)

@st.cache_data
def load_data():
    """Load and process financial data"""
    # Replace this with your actual CSV loading
    df = pd.read_csv("FinanceSheet25.csv")
    
    # Clean the data (using your existing logic)
    df = df.rename(columns={'Withdrawal (-)': 'Withdrawals', 'Deposit (+)': 'Deposits'})
    df['Date'] = pd.to_datetime(df['Date'], format='%m/%d/%Y', errors='coerce')
    
    # Clean and convert amounts
    # Handle string cleaning first > numeric
    if df['Withdrawals'].dtype=='object':
        df['Withdrawals']=df['Withdrawals'].str.replace('$', '', regex=False)
        df['Withdrawals']=df['Withdrawals'].str.replace(',', '', regex=False)
        df['Withdrawals']=pd.to_numeric(df['Withdrawals'], errors='coerce').fillna(0)

    if df['Deposits'].dtype=='object':
        df['Deposits']=df['Deposits'].str.replace('$', '', regex=False)
        df['Deposits']=df['Deposits'].str.replace(',', '', regex=False)
        df['Deposits']=pd.to_numeric(df['Deposits'], errors='coerce').fillna(0)
           
    df['Amount'] = df['Deposits'] - df['Withdrawals']
    
    # Clean categories and accounts
    df = df[(df['Category'] != '') & (df['Category'].notna())]
    valid_transactions = (df['Withdrawals'] > 0) | (df['Deposits'] > 0)
    df = df[valid_transactions]
    
    # Add date components
    df['Month'] = df['Date'].dt.month
    df['Year'] = df['Date'].dt.year
    df['Month_Year'] = df['Date'].dt.to_period('M')
    df['Week'] = df['Date'].dt.isocalendar().week
    
    # Clean string columns
    df['Category'] = df['Category'].str.title()
    if 'Account' in df.columns:
        df['Account'] = df['Account'].str.title()
    
    return df.sort_values('Date').reset_index(drop=True)

def main():
    st.title("💰 Interactive Financial Dashboard")
    st.markdown("---")
    
    # Load data
    try:
        df = load_data()
    except FileNotFoundError:
        st.error("Please make sure 'FinanceSheet25.csv' is in the same directory as this script.")
        st.stop()
    except Exception as e:
        st.error(f"Error loading data: {str(e)}")
        st.stop()
    
    # Sidebar filters
    st.sidebar.header("🔍 Filters")
    
    # Date range filter
    min_date = df['Date'].min().date()
    max_date = df['Date'].max().date()
    date_range = st.sidebar.date_input(
        "Select Date Range",
        value=(min_date, max_date),
        min_value=min_date,
        max_value=max_date
    )
    
    # Category filter
    all_categories = sorted(df['Category'].unique())
    selected_categories = st.sidebar.multiselect(
        "Select Categories",
        options=all_categories,
        default=all_categories
    )
    
    # Account filter (if Account column exists)
    if 'Account' in df.columns:
        all_accounts = sorted(df['Account'].unique())
        selected_accounts = st.sidebar.multiselect(
            "Select Accounts",
            options=all_accounts,
            default=all_accounts
        )
    else:
        selected_accounts = None
    
    # Amount range filter
    min_amount = float(df['Amount'].min())
    max_amount = float(df['Amount'].max())
    amount_range = st.sidebar.slider(
        "Amount Range",
        min_value=min_amount,
        max_value=max_amount,
        value=(min_amount, max_amount),
        step=1.0
    )
    
    # Apply filters
    if len(date_range) == 2:
        start_date, end_date = date_range
        filtered_df = df[
            (df['Date'].dt.date >= start_date) & 
            (df['Date'].dt.date <= end_date)
        ]
    else:
        filtered_df = df
    
    filtered_df = filtered_df[filtered_df['Category'].isin(selected_categories)]
    
    if selected_accounts and 'Account' in df.columns:
        filtered_df = filtered_df[filtered_df['Account'].isin(selected_accounts)]
    
    filtered_df = filtered_df[
        (filtered_df['Amount'] >= amount_range[0]) & 
        (filtered_df['Amount'] <= amount_range[1])
    ]
    
    # Summary metrics
    col1, col2, col3, col4 = st.columns(4)
    
    total_income = filtered_df[filtered_df['Amount'] > 0]['Amount'].sum()
    total_expenses = filtered_df[filtered_df['Amount'] < 0]['Amount'].abs().sum()
    net_amount = total_income - total_expenses
    transaction_count = len(filtered_df)
    
    with col1:
        st.metric(
            label="💚 Total Income",
            value=f"${total_income:,.2f}"
        )
    
    with col2:
        st.metric(
            label="💸 Total Expenses",
            value=f"${total_expenses:,.2f}"
        )
    
    with col3:
        st.metric(
            label="💰 Net Amount",
            value=f"${net_amount:,.2f}",
            delta=f"{'Profit' if net_amount >= 0 else 'Loss'}"
        )
    
    with col4:
        st.metric(
            label="📊 Transactions",
            value=transaction_count
        )
    
    st.markdown("---")
    
    # Main dashboard tabs
    tab1, tab2, tab3, tab4, tab5 = st.tabs([
        "📈 Monthly Trends", 
        "🏷️ Category Analysis", 
        "💳 Account Analysis", 
        "📊 Transaction Details",
        "🎯 Goals & Insights"
    ])
    
    with tab1:
        st.subheader("Monthly Spending Trends")
        
        # Monthly spending by category
        monthly_spending = filtered_df[filtered_df['Amount'] < 0].groupby(['Month_Year', 'Category'])['Amount'].sum().abs().reset_index()
        monthly_spending['Month_Year'] = monthly_spending['Month_Year'].astype(str)
        
        if not monthly_spending.empty:
            fig = px.line(
                monthly_spending.groupby(['Month_Year', 'Category'])['Amount'].sum().reset_index(),
                x='Month_Year',
                y='Amount',
                color='Category',
                title='Monthly Spending by Category',
                markers=True
            )
            fig.update_layout(xaxis_title="Month", yaxis_title="Amount ($)")
            st.plotly_chart(fig, use_container_width=True)
            
            # Monthly net flow
            monthly_net = filtered_df.groupby('Month_Year')['Amount'].sum().reset_index()
            monthly_net['Month_Year'] = monthly_net['Month_Year'].astype(str)
            
            fig2 = px.bar(
                monthly_net,
                x='Month_Year',
                y='Amount',
                title='Monthly Net Cash Flow',
                color='Amount',
                color_continuous_scale=['red', 'green']
            )
            fig2.add_hline(y=0, line_dash="dash", line_color="black")
            st.plotly_chart(fig2, use_container_width=True)
    
    with tab2:
        st.subheader("Category Analysis")
        
        col1, col2 = st.columns(2)
        
        with col1:
            # Spending by category (pie chart)
            expense_by_category = filtered_df[filtered_df['Amount'] < 0].groupby('Category')['Amount'].sum().abs()
            
            if not expense_by_category.empty:
                fig = px.pie(
                    values=expense_by_category.values,
                    names=expense_by_category.index,
                    title='Expenses by Category'
                )
                st.plotly_chart(fig, use_container_width=True)
        
        with col2:
            # Average spending by category
            avg_spending = filtered_df[filtered_df['Amount'] < 0].groupby('Category').agg({
                'Amount': ['mean', 'count', 'sum']
            }).round(2)
            avg_spending.columns = ['Average', 'Count', 'Total']
            avg_spending['Total'] = avg_spending['Total'].abs()
            avg_spending['Average'] = avg_spending['Average'].abs()
            avg_spending = avg_spending.sort_values('Average', ascending=False)
            
            st.write("**Average Spending by Category**")
            st.dataframe(avg_spending, use_container_width=True)
        
        # Category spending over time
        category_trend = filtered_df[filtered_df['Amount'] < 0].groupby(['Date', 'Category'])['Amount'].sum().abs().reset_index()
        
        if not category_trend.empty:
            fig = px.scatter(
                category_trend,
                x='Date',
                y='Amount',
                color='Category',
                title='Category Spending Over Time',
                size='Amount',
                hover_data=['Category', 'Amount']
            )
            st.plotly_chart(fig, use_container_width=True)
    
    with tab3:
        if 'Account' in filtered_df.columns:
            st.subheader("Account Analysis")
            
            col1, col2 = st.columns(2)
            
            with col1:
                # Spending by account
                account_spending = filtered_df[filtered_df['Amount'] < 0].groupby('Account')['Amount'].sum().abs()
                
                fig = px.bar(
                    x=account_spending.index,
                    y=account_spending.values,
                    title='Expenses by Account',
                    labels={'x': 'Account', 'y': 'Amount ($)'}
                )
                st.plotly_chart(fig, use_container_width=True)
            
            with col2:
                # Account balance flow
                account_flow = filtered_df.groupby('Account')['Amount'].sum().sort_values()
                
                colors = ['red' if x < 0 else 'green' for x in account_flow.values]
                fig = px.bar(
                    x=account_flow.index,
                    y=account_flow.values,
                    title='Net Flow by Account',
                    labels={'x': 'Account', 'y': 'Net Amount ($)'},
                    color=account_flow.values,
                    color_continuous_scale=['red', 'green']
                )
                fig.add_hline(y=0, line_dash="dash", line_color="black")
                st.plotly_chart(fig, use_container_width=True)
        else:
            st.info("Account information not available in the data.")
    
    with tab4:
        st.subheader("Transaction Details")
        
        # Display options
        col1, col2, col3 = st.columns(3)
        with col1:
            show_expenses = st.checkbox("Show Expenses", value=True)
        with col2:
            show_income = st.checkbox("Show Income", value=True)
        with col3:
            sort_by = st.selectbox("Sort by", ["Date", "Amount", "Category"])
        
        # Filter and display transactions
        display_df = filtered_df.copy()
        
        if not show_expenses:
            display_df = display_df[display_df['Amount'] >= 0]
        if not show_income:
            display_df = display_df[display_df['Amount'] < 0]
        
        display_df = display_df.sort_values(sort_by, ascending=False)
        
        # Format for display
        display_columns = ['Date', 'Category', 'Amount']
        if 'Store' in display_df.columns:
            display_columns.insert(-1, 'Store')
        if 'Account' in display_df.columns:
            display_columns.insert(-1, 'Account')
        
        st.dataframe(
            display_df[display_columns].head(100),  # Show first 100 transactions
            use_container_width=True
        )
        
        st.info(f"Showing {len(display_df)} transactions (limited to first 100)")
    
    with tab5:
        st.subheader("Financial Insights & Goals")
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.write("**📊 Key Insights:**")
            
            # Top spending category
            if not filtered_df[filtered_df['Amount'] < 0].empty:
                top_category = filtered_df[filtered_df['Amount'] < 0].groupby('Category')['Amount'].sum().abs().idxmax()
                top_amount = filtered_df[filtered_df['Amount'] < 0].groupby('Category')['Amount'].sum().abs().max()
                st.write(f"• **Highest spending category:** {top_category} (${top_amount:,.2f})")
                
                # Average transaction size
                avg_expense = filtered_df[filtered_df['Amount'] < 0]['Amount'].abs().mean()
                st.write(f"• **Average expense:** ${avg_expense:.2f}")
                
                # Most frequent category
                most_frequent = filtered_df[filtered_df['Amount'] < 0]['Category'].mode().iloc[0]
                freq_count = filtered_df[filtered_df['Amount'] < 0]['Category'].value_counts().iloc[0]
                st.write(f"• **Most frequent expense:** {most_frequent} ({freq_count} transactions)")
                
                # Weekly spending average
                weekly_avg = (total_expenses / ((filtered_df['Date'].max() - filtered_df['Date'].min()).days / 7))
                st.write(f"• **Weekly spending average:** ${weekly_avg:.2f}")
                
                # Monthly savings rate
                if total_income > 0:
                    savings_rate = ((total_income - total_expenses) / total_income) * 100
                    st.write(f"• **Savings rate:** {savings_rate:.1f}%")
        
        with col2:
            st.write("**🎯 Financial Goals Tracker:**")
            
            # Goal setting interface
            monthly_budget = st.number_input("Set Monthly Budget Goal ($)", min_value=0.0, value=3000.0, step=100.0)
            savings_goal = st.number_input("Set Monthly Savings Goal ($)", min_value=0.0, value=500.0, step=50.0)
            
            # Calculate current month performance
            current_month = filtered_df[filtered_df['Date'].dt.month == datetime.now().month]
            if not current_month.empty:
                current_expenses = current_month[current_month['Amount'] < 0]['Amount'].abs().sum()
                current_income = current_month[current_month['Amount'] > 0]['Amount'].sum()
                current_savings = current_income - current_expenses
                
                # Budget progress
                budget_progress = (current_expenses / monthly_budget) * 100 if monthly_budget > 0 else 0
                budget_color = "green" if budget_progress <= 100 else "red"
                st.metric(
                    "Budget Usage",
                    f"{budget_progress:.1f}%",
                    f"${current_expenses:.2f} / ${monthly_budget:.2f}"
                )
                
                # Savings progress
                savings_progress = (current_savings / savings_goal) * 100 if savings_goal > 0 else 0
                savings_color = "green" if savings_progress >= 100 else "orange"
                st.metric(
                    "Savings Goal",
                    f"{savings_progress:.1f}%",
                    f"${current_savings:.2f} / ${savings_goal:.2f}"
                )
        
        # Spending predictions and trends
        st.markdown("---")
        st.write("**📈 Spending Trends & Predictions:**")
        
        if len(filtered_df) > 30:  # Need sufficient data
            # Monthly trend analysis
            monthly_totals = filtered_df[filtered_df['Amount'] < 0].groupby('Month_Year')['Amount'].sum().abs()
            
            if len(monthly_totals) >= 3:
                # Simple trend calculation
                recent_avg = monthly_totals.tail(3).mean()
                older_avg = monthly_totals.head(3).mean()
                trend = ((recent_avg - older_avg) / older_avg * 100) if older_avg != 0 else 0
                
                trend_direction = "📈 increasing" if trend > 5 else "📉 decreasing" if trend < -5 else "➡️ stable"
                st.write(f"• **Spending trend:** {trend_direction} ({trend:+.1f}% change)")
                
                # Projected next month
                if trend != 0:
                    projected_next = recent_avg * (1 + trend/100)
                    st.write(f"• **Projected next month:** ${projected_next:.2f}")
        
        # Category recommendations
        st.markdown("---")
        st.write("**💡 Recommendations:**")
        
        if not filtered_df[filtered_df['Amount'] < 0].empty:
            category_spending = filtered_df[filtered_df['Amount'] < 0].groupby('Category')['Amount'].sum().abs().sort_values(ascending=False)
            
            if len(category_spending) >= 3:
                top_3_categories = category_spending.head(3)
                st.write("Consider reviewing these top spending categories:")
                for i, (cat, amount) in enumerate(top_3_categories.items(), 1):
                    percentage = (amount / total_expenses) * 100
                    st.write(f"  {i}. **{cat}**: ${amount:.2f} ({percentage:.1f}% of total expenses)")

if __name__ == "__main__":
    main()
    
# Instructions for running:
"""
To run this interactive dashboard:

1. Install required packages:
   pip install streamlit plotly pandas numpy

2. Save this code as 'financial_dashboard.py'

3. Run the dashboard:
   streamlit run financial_dashboard.py

4. Open your browser to the URL shown (usually http://localhost:8501)

Features included:
- Interactive filters (date range, categories, accounts, amount range)
- Real-time summary metrics
- Multiple visualization tabs
- Monthly trends analysis
- Category breakdown and analysis
- Account analysis (if available)
- Detailed transaction viewer
- Financial goals tracking
- Spending predictions and recommendations
- Responsive layout that works on different screen sizes

The dashboard will automatically refresh when you change filters or inputs.
"""