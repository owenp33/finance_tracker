console.log("Starting scripts...")

class FinanceTracker {
    constructor() {
        this.apiBase = 'http://localhost:3000/api';
        this.charts = {};
        this.init();
    }
    
    async init() {
        try {
            // Show loading state
            this.showLoading();
            
            // Test API connection first
            await this.testConnection();
            
            await this.loadSummary();
            await this.loadCharts();
            await this.loadCalendar();
            await this.loadRecentTransactions();
        } catch (error) {
            console.error('Error initializing dashboard:', error);
            this.showError('Failed to load dashboard data. Please check if the server is running.');
        }
    }
    
    async testConnection() {
        try {
            const response = await fetch(`${this.apiBase}/test`);
            if (!response.ok) throw new Error('Server not responding');
            const data = await response.json();
            console.log('API Test:', data);
        } catch (error) {
            throw new Error('Cannot connect to server. Make sure Flask app is running on port 5000.');
        }
    }
    
    showLoading() {
        document.getElementById('total-transactions').textContent = 'Loading...';
        document.getElementById('total-income').textContent = 'Loading...';
        document.getElementById('total-expenses').textContent = 'Loading...';
        document.getElementById('net-amount').textContent = 'Loading...';
    }
    
    showError(message) {
        const container = document.querySelector('.container');
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        errorDiv.textContent = message;
        container.insertBefore(errorDiv, container.firstChild);
    }
    
    async fetchData(endpoint) {
        const response = await fetch(`${this.apiBase}${endpoint}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    }
    
    async loadSummary() {
        try {
            const summary = await this.fetchData('/summary');
            
            if (summary.error) {
                throw new Error(summary.error);
            }
            
            document.getElementById('total-transactions').textContent = summary.totalTransactions || 0;
            document.getElementById('total-income').textContent = `$${(summary.totalDeposits || 0).toFixed(2)}`;
            document.getElementById('total-expenses').textContent = `$${(summary.totalWithdrawals || 0).toFixed(2)}`;
            document.getElementById('net-amount').textContent = `$${(summary.netAmount || 0).toFixed(2)}`;
        } catch (error) {
            console.error('Error loading summary:', error);
            // Set default values
            document.getElementById('total-transactions').textContent = '0';
            document.getElementById('total-income').textContent = '$0.00';
            document.getElementById('total-expenses').textContent = '$0.00';
            document.getElementById('net-amount').textContent = '$0.00';
        }
    }
    
    async loadCharts() {
        try {
            // Spending by category pie chart
            const categoryData = await this.fetchData('/spending-by-category');
            this.createPieChart('spending-chart', 'Spending by Category', categoryData);
            
            // Monthly trends line chart
            const trendsData = await this.fetchData('/monthly-trends');
            this.createLineChart('trends-chart', 'Monthly Income vs Expenses', trendsData);
        } catch (error) {
            console.error('Error loading charts:', error);
        }
    }
    
    createPieChart(canvasId, title, data) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        // Destroy existing chart if it exists
        if (this.charts[canvasId]) {
            this.charts[canvasId].destroy();
        }
        
        this.charts[canvasId] = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: data.labels || [],
                datasets: [{
                    data: data.data || [],
                    backgroundColor: [
                        '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
                        '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF'
                    ],
                    borderWidth: 1,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: false
                    },
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 20,
                            usePointStyle: true
                        }
                    }
                }
            }
        });
    }
    
    createLineChart(canvasId, title, data) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        
        // Destroy existing chart if it exists
        if (this.charts[canvasId]) {
            this.charts[canvasId].destroy();
        }
        
        this.charts[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels || [],
                datasets: [{
                    label: 'Income',
                    data: data.income || [],
                    borderColor: '#4BC0C0',
                    backgroundColor: 'rgba(75, 192, 192, 0.1)',
                    fill: true,
                    tension: 0.4
                }, {
                    label: 'Expenses',
                    data: data.expenses || [],
                    borderColor: '#FF6384',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: false
                    },
                    legend: {
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toFixed(0);
                            }
                        }
                    }
                }
            }
        });
    }
    
    async loadCalendar() {
        try {
            const calendarData = await this.fetchData('/calendar-data');
            this.renderCalendar(calendarData);
        } catch (error) {
            console.error('Error loading calendar:', error);
            this.renderCalendar([]);
        }
    }
    
    renderCalendar(events) {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        document.getElementById('current-month').textContent = 
            `${now.toLocaleString('default', { month: 'long' })} ${currentYear}`;
        
        const calendarGrid = document.getElementById('calendar-grid');
        calendarGrid.innerHTML = '';
        
        // Add day headers
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        days.forEach(day => {
            const dayHeader = document.createElement('div');
            dayHeader.className = 'calendar-header-day';
            dayHeader.textContent = day;
            calendarGrid.appendChild(dayHeader);
        });
        
        // Get first day of month and number of days
        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        
        // Add empty cells for days before month starts
        for (let i = 0; i < firstDay; i++) {
            const emptyDay = document.createElement('div');
            emptyDay.className = 'calendar-day';
            calendarGrid.appendChild(emptyDay);
        }
        
        // Add days of the month
        for (let day = 1; day <= daysInMonth; day++) {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'calendar-day';
            dayDiv.innerHTML = `<strong>${day}</strong>`;
            
            // Check for events on this day
            const dayEvents = events.filter(event => {
                const eventDate = new Date(event.date);
                return eventDate.getDate() === day && 
                        eventDate.getMonth() === currentMonth &&
                        eventDate.getFullYear() === currentYear;
            });
            
            if (dayEvents.length > 0) {
                dayDiv.classList.add('has-event');
                dayEvents.forEach(event => {
                    const eventDiv = document.createElement('div');
                    eventDiv.className = `calendar-event ${event.type}`;
                    eventDiv.textContent = event.title;
                    eventDiv.title = `${event.title}: $${Math.abs(event.amount)}`;
                    dayDiv.appendChild(eventDiv);
                });
            }
            
            calendarGrid.appendChild(dayDiv);
        }
    }
    
    async loadRecentTransactions() {
        try {
            const transactions = await this.fetchData('/recent-transactions');
            this.renderTransactions(transactions);
        } catch (error) {
            console.error('Error loading transactions:', error);
            this.renderTransactions([]);
        }
    }
    
    renderTransactions(transactions) {
        const container = document.getElementById('recent-transactions');
        container.innerHTML = '';
        
        if (!transactions || transactions.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #57606f; padding: 2rem;">No transactions found</p>';
            return;
        }
        
        transactions.forEach(transaction => {
            const transactionDiv = document.createElement('div');
            transactionDiv.className = 'transaction-item';
            
            transactionDiv.innerHTML = `
                <div class="transaction-info">
                    <strong>${transaction.store || 'Unknown'}</strong><br>
                    <small>${transaction.category || 'Uncategorized'} • ${transaction.date || 'N/A'}</small>
                </div>
                <div class="transaction-amount ${transaction.type}">
                    ${transaction.amount >= 0 ? '+' : ''}$${Math.abs(transaction.amount || 0).toFixed(2)}
                </div>
            `;
            
            container.appendChild(transactionDiv);
        });
    }
    
    // Additional utility methods
    async reloadData() {
        try {
            const response = await this.fetchData('/reload-data');
            if (response.success) {
                console.log('Data reloaded:', response.message);
                await this.init(); // Reinitialize dashboard
            }
        } catch (error) {
            console.error('Error reloading data:', error);
        }
    }
    
    formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(amount);
    }
    
    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
}

// Transaction form functionality (outside of class)
function setTodayDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateInput = document.getElementById('date');
    if (dateInput) {
        dateInput.value = `${year}-${month}-${day}`;
    }
}

// Load categories on page load
async function loadCategories() {
    try {
        const response = await fetch('http://localhost:5000/api/categories');
        const data = await response.json();
        
        if (data.success) {
            const categorySelect = document.getElementById('category');
            if (!categorySelect) return;
            
            // Clear existing options first
            categorySelect.innerHTML = '<option value="">Select a category</option>';
            
            // Add existing categories
            data.categories.forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                categorySelect.appendChild(option);
            });
            
            // Add option to create new category
            const newOption = document.createElement('option');
            newOption.value = 'NEW_CATEGORY';
            newOption.textContent = '+ Add New Category';
            categorySelect.appendChild(newOption);
        }
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

function showMessage(text, type) {
    const messageDiv = document.getElementById('message');
    if (!messageDiv) return;
    
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    
    // Trigger animation
    setTimeout(() => {
        messageDiv.classList.add('show');
    }, 10);
    
    // Hide after 5 seconds
    setTimeout(() => {
        messageDiv.classList.remove('show');
    }, 5000);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize the dashboard
    new FinanceTracker();
    
    // Set today's date if date input exists
    setTodayDate();
    
    // Load categories if category select exists
    loadCategories();
    
    // Handle new category input
    const categorySelect = document.getElementById('category');
    if (categorySelect) {
        categorySelect.addEventListener('change', function() {
            if (this.value === 'NEW_CATEGORY') {
                const newCategory = prompt('Enter new category name:');
                if (newCategory && newCategory.trim()) {
                    const option = document.createElement('option');
                    option.value = newCategory.trim();
                    option.textContent = newCategory.trim();
                    option.selected = true;
                    
                    // Insert before the "Add New Category" option
                    this.insertBefore(option, this.lastElementChild);
                } else {
                    this.value = '';
                }
            }
        });
    }

    // Handle form submission
    const transactionForm = document.getElementById('transactionForm');
    if (transactionForm) {
        transactionForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const submitBtn = document.getElementById('submitBtn');
            const messageDiv = document.getElementById('message');
            
            // Get form data
            const formData = {
                title: document.getElementById('title').value.trim(),
                category: document.getElementById('category').value,
                amount: document.getElementById('amount').value,
                date: document.getElementById('date').value
            };
            
            // Validate category is not "NEW_CATEGORY"
            if (formData.category === 'NEW_CATEGORY') {
                showMessage('Please select a valid category', 'error');
                return;
            }
            
            // Show loading state
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="loading"></span>Adding...';
            }
            
            try {
                const response = await fetch('http://localhost:5000/api/append', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(formData)
                });
                
                const data = await response.json();
                
                if (data.success) {
                    showMessage(data.message, 'success');
                    transactionForm.reset();
                    setTodayDate(); // Reset to today's date
                } else {
                    showMessage(data.message, 'error');
                }
                
            } catch (error) {
                showMessage('Network error. Please check your connection.', 'error');
                console.error('Error:', error);
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Add Transaction';
                }
            }
        });
    }
});