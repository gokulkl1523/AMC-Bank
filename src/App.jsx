import { useEffect, useState } from 'react';

const API = 'http://localhost:8080/api'; // calling Spring Boot Rest API for backend access
const APP_VERSION = 'v6-persistent-transaction-popups';

// Prevent a JWT/role saved by an older project version from being reused.
if (localStorage.getItem('amc_app_version') !== APP_VERSION) {
  localStorage.removeItem('amc_token');
  localStorage.removeItem('amc_username');
  localStorage.removeItem('amc_role');
  localStorage.setItem('amc_app_version', APP_VERSION);
}

async function request(url, options = {}) {
  // Never attach an old/stale token to the login request.
  const token = url === '/login' ? null : localStorage.getItem('amc_token');

  const response = await fetch(API + url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    let message = 'Request failed';
    try {
      const data = await response.json();
      message = data.message || message;
    } catch {
      // Keep the default message if the response has no JSON body.
    }

    if (response.status === 401 && url !== '/login') {
      clearLogin();
      window.location.reload();
    }
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}

function clearLogin() {
  localStorage.removeItem('amc_token');
  localStorage.removeItem('amc_username');
  localStorage.removeItem('amc_role');
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(Boolean(localStorage.getItem('amc_token')));
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [message, setMessage] = useState('');

  if (!loggedIn) {
    async function login(e) {
      e.preventDefault();
      setMessage('');

      try {
        const data = await request('/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });

        if (!['ROLE_ADMIN', 'ROLE_CUSTOMER'].includes(data.role)) {
          throw new Error(`Unsupported login role: ${data.role}`);
        }

        localStorage.setItem('amc_token', data.token);
        localStorage.setItem('amc_username', data.username);
        localStorage.setItem('amc_role', data.role);

        // Verify the newly issued token against Spring Security before showing
        // the admin/customer application. This catches role/token mismatches early.
        const auth = await request('/auth/me');
        if (!auth.authorities?.includes(data.role)) {
          clearLogin();
          throw new Error('Login role verification failed. Please login again.');
        }

        setLoggedIn(true);
      } catch (err) {
        setMessage(err.message);
      }
    }

    return (
      <div className="login-page">
        <form className="card login-card" onSubmit={login}>
          <h1>AMC Bank</h1>
          <label>Username / Customer Email</label>
          <input value={username} onChange={e => setUsername(e.target.value)} required />
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          {message && <p className="error">{message}</p>}
          <button>Login</button>
        
        </form>
      </div>
    );
  }

  function logout() {
    clearLogin();
    setLoggedIn(false);
  }

  const role = localStorage.getItem('amc_role') || '';
  const usernameFromLogin = localStorage.getItem('amc_username') || '';

  if (role === 'ROLE_CUSTOMER') {
    return <CustomerApplication username={usernameFromLogin} role={role} onLogout={logout} />;
  }

  if (role === 'ROLE_ADMIN') {
    return <AdminApplication username={usernameFromLogin || 'admin'} role={role} onLogout={logout} />;
  }

  // A stale/invalid role in localStorage must never be treated as admin.
  clearLogin();
  return (
    <div className="login-page">
      <div className="card login-card">
        <h2>Session reset</h2>
        <p className="error">Invalid saved role. Refresh the page and login again.</p>
      </div>
    </div>
  );
}

function AdminApplication({ username, role, onLogout }) {
  const [view, setView] = useState('dashboard');
  const [stats, setStats] = useState({ customers: 0, activeAccounts: 0, activeLoans: 0 });
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [customerLoans, setCustomerLoans] = useState([]);
  const [allLoans, setAllLoans] = useState([]);
  const [loanCustomerId, setLoanCustomerId] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [customerForm, setCustomerForm] = useState({
    name: '', email: '', city: '', panNumber: '', initialPassword: ''
  });
  const [accountForm, setAccountForm] = useState({ type: 'SAVINGS', balance: 0 });
  const [loanForm, setLoanForm] = useState({
    type: 'HOME', principal: 10000, interestRate: 8, tenureMonths: 12
  });
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState(null);

  function showToast(title, detail) {
    setToast({ title, detail });
  }

  useEffect(() => {
    loadDashboard();
    loadCustomers('');
  }, []);

  async function run(action) {
    setMessage('');
    try {
      await action();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function loadDashboard() {
    setStats(await request('/dashboard'));
  }

  async function loadCustomers(text = search) {
    const data = await request(`/customers?search=${encodeURIComponent(text)}`);
    setCustomers(data);
    return data;
  }

  async function openLoansModule() {
    await run(async () => {
      const [customerData, loanData] = await Promise.all([
        request('/customers?search='),
        request('/loans')
      ]);
      setCustomers(customerData);
      setAllLoans(loanData);
      if (!loanCustomerId && customerData.length > 0) {
        setLoanCustomerId(String(customerData[0].id));
      }
      setView('loans');
    });
  }

  function emptyCustomerForm() {
    return { name: '', email: '', city: '', panNumber: '', initialPassword: '' };
  }

  async function saveCustomer(e) {
    e.preventDefault();
    await run(async () => {
      const isUpdate = Boolean(editingId);
      if (editingId) {
        const { initialPassword, ...updateData } = customerForm;
        await request(`/customers/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(updateData)
        });
      } else {
        await request('/customers', {
          method: 'POST',
          body: JSON.stringify(customerForm)
        });
      }
      setEditingId(null);
      setCustomerForm(emptyCustomerForm());
      await loadCustomers();
      await loadDashboard();
      const action = isUpdate
        ? 'Customer updated successfully'
        : 'Customer and login created successfully';
      setMessage(action);
      showToast(action, isUpdate
        ? 'The customer details are saved and will be available after restarting the app.'
        : 'The customer profile and login have been saved.');
    });
  }

  function editCustomer(customer) {
    setEditingId(customer.id);
    setCustomerForm({
      name: customer.name,
      email: customer.email,
      city: customer.city || '',
      panNumber: customer.panNumber,
      initialPassword: ''
    });
    setView('customers');
  }

  async function deleteCustomer(id) {
    if (!confirm('Delete this customer and customer login?')) return;
    await run(async () => {
      await request(`/customers/${id}`, { method: 'DELETE' });
      await loadCustomers();
      await loadDashboard();
      setMessage('Customer and login deleted');
      showToast('Customer deleted', 'The customer profile and login have been removed.');
    });
  }

  async function openCustomer(customer) {
    await run(async () => {
      setSelectedCustomer(customer);
      setAccounts(await request(`/customers/${customer.id}/accounts`));
      setCustomerLoans(await request(`/customers/${customer.id}/loans`));
      setView('customer');
    });
  }

  async function openAccount(e) {
    e.preventDefault();
    await run(async () => {
      const createdAccount = await request(`/customers/${selectedCustomer.id}/accounts`, {
        method: 'POST',
        body: JSON.stringify({ ...accountForm, balance: Number(accountForm.balance) })
      });
      setAccounts(await request(`/customers/${selectedCustomer.id}/accounts`));
      await loadDashboard();
      setMessage('Account opened successfully');
      showToast('Account opened', `${createdAccount.type} account ${createdAccount.accountNumber} is ready to use.`);
    });
  }

  async function money(accountId, operation) {
    const account = accounts.find(item => item.id === accountId);
    const amount = prompt(`Enter amount to ${operation}:`);
    if (amount === null) return;

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setMessage('Amount must be greater than zero');
      return;
    }

    if (operation === 'withdraw' && numericAmount > Number(account?.balance || 0)) {
      setMessage(`Withdrawal denied. Available balance is ₹${Number(account.balance).toLocaleString()}`);
      return;
    }

    await run(async () => {
      const updatedAccount = await request(`/accounts/${accountId}/${operation}?amount=${encodeURIComponent(amount)}`, {
        method: 'POST'
      });
      setAccounts(await request(`/customers/${selectedCustomer.id}/accounts`));
      const action = operation === 'deposit' ? 'Deposit successful' : 'Withdrawal successful';
      setMessage(action);
      showToast(action, `₹${numericAmount.toLocaleString()} • ${updatedAccount.accountNumber} • New balance ₹${Number(updatedAccount.balance).toLocaleString()}`);
    });
  }

  function loanPayload() {
    return {
      ...loanForm,
      principal: Number(loanForm.principal),
      interestRate: Number(loanForm.interestRate),
      tenureMonths: Number(loanForm.tenureMonths)
    };
  }

  async function sanctionLoanForCustomer(customerId) {
    await request(`/customers/${customerId}/loans`, {
      method: 'POST',
      body: JSON.stringify(loanPayload())
    });
  }

  async function sanctionLoanFromCustomer(e) {
    e.preventDefault();
    await run(async () => {
      await sanctionLoanForCustomer(selectedCustomer.id);
      setCustomerLoans(await request(`/customers/${selectedCustomer.id}/loans`));
      await loadDashboard();
      setMessage('Loan sanctioned successfully');
      showToast('Loan sanctioned', 'The customer loan has been saved successfully.');
    });
  }

  async function sanctionLoanFromModule(e) {
    e.preventDefault();
    await run(async () => {
      if (!loanCustomerId) throw new Error('Please select a customer');
      await sanctionLoanForCustomer(loanCustomerId);
      setAllLoans(await request('/loans'));
      await loadDashboard();
      setMessage('Loan sanctioned successfully');
      showToast('Loan sanctioned', 'The customer loan has been saved successfully.');
    });
  }

  return (
    <div>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <Header username={username} role={role} onLogout={onLogout}>
        <button className="nav-button" onClick={() => { setView('dashboard'); loadDashboard(); }}>Dashboard</button>
        <button className="nav-button" onClick={() => { setView('customers'); loadCustomers(); }}>Customers</button>
        <button className="nav-button loan-nav" onClick={openLoansModule}>Loans</button>
      </Header>

      <main>
        <Message text={message} />

        {view === 'dashboard' && (
          <section>
            <h2>Admin Dashboard</h2>
            <div className="stats">
              <Stat title="Customers" value={stats.customers} />
              <Stat title="Active Accounts" value={stats.activeAccounts} />
              <Stat title="Active Loans" value={stats.activeLoans} />
            </div>
            <div className="card module-banner customer-login-banner">
              <div>
                <h3>Customer Login Facility</h3>
                <p>When adding a customer, create the first password. The customer's email becomes the login ID.</p>
              </div>
              <button onClick={() => setView('customers')}>Create Customer Login</button>
            </div>
            <div className="card module-banner">
              <div>
                <h3>Loan Module</h3>
                <p>Sanction HOME, CAR and PERSONAL loans, calculate EMI and view all sanctioned loans.</p>
              </div>
              <button onClick={openLoansModule}>Open Loan Module</button>
            </div>
          </section>
        )}

        {view === 'customers' && (
          <section>
            <h2>Customers</h2>
            <div className="grid-2">
              <div className="card">
                <h3>{editingId ? 'Edit Customer' : 'Add Customer + Create Login'}</h3>
                <form onSubmit={saveCustomer}>
                  <label>Name</label>
                  <input placeholder="Name" value={customerForm.name} onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })} required />
                  <label>Email / Customer Login ID</label>
                  <input type="email" placeholder="customer@example.com" value={customerForm.email} onChange={e => setCustomerForm({ ...customerForm, email: e.target.value })} required />
                  <label>City</label>
                  <input placeholder="City" value={customerForm.city} onChange={e => setCustomerForm({ ...customerForm, city: e.target.value })} />
                  <label>PAN Number</label>
                  <input placeholder="PAN Number" value={customerForm.panNumber} onChange={e => setCustomerForm({ ...customerForm, panNumber: e.target.value.toUpperCase() })} required />
                  {!editingId && (
                    <>
                      <label>First Login Password</label>
                      <input
                        type="password"
                        minLength="6"
                        placeholder="Minimum 6 characters"
                        value={customerForm.initialPassword}
                        onChange={e => setCustomerForm({ ...customerForm, initialPassword: e.target.value })}
                        required
                      />
                      <p className="hint">Give this temporary/first password to the customer. The customer can change it after login.</p>
                    </>
                  )}
                  {editingId && <p className="hint">Changing the email also changes the customer's login ID. Password is not changed here.</p>}
                  <div className="actions">
                    <button>{editingId ? 'Update Customer' : 'Create Customer + Login'}</button>
                    {editingId && (
                      <button type="button" className="secondary" onClick={() => { setEditingId(null); setCustomerForm(emptyCustomerForm()); }}>
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </div>

              <div className="card">
                <h3>Search</h3>
                <div className="actions">
                  <input placeholder="Name or city" value={search} onChange={e => setSearch(e.target.value)} />
                  <button onClick={() => loadCustomers()}>Search</button>
                  <button className="secondary" onClick={() => { setSearch(''); loadCustomers(''); }}>Clear</button>
                </div>
                <hr />
                <p><strong>Customer login rule</strong></p>
                <p className="muted">Login ID = customer's email address. Password = first password entered by the admin.</p>
              </div>
            </div>

            <div className="card table-wrap">
              <table>
                <thead><tr><th>ID</th><th>Name</th><th>Login Email</th><th>City</th><th>PAN</th><th>Actions</th></tr></thead>
                <tbody>
                  {customers.map(c => (
                    <tr key={c.id}>
                      <td>{c.id}</td><td>{c.name}</td><td>{c.email}</td><td>{c.city}</td><td>{c.panNumber}</td>
                      <td className="actions">
                        <button onClick={() => openCustomer(c)}>View</button>
                        <button className="secondary" onClick={() => editCustomer(c)}>Edit</button>
                        <button className="danger" onClick={() => deleteCustomer(c.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                  {customers.length === 0 && <tr><td colSpan="6">No customers found.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {view === 'loans' && (
          <section>
            <div className="module-title">
              <div><h2>Loan Module</h2><p className="muted">Sanction a loan and view all loans.</p></div>
              <span className="module-badge">{allLoans.length} loan(s)</span>
            </div>

            <div className="grid-2">
              <div className="card">
                <h3>Sanction New Loan</h3>
                {customers.length === 0 ? <p>Add a customer first.</p> : (
                  <form onSubmit={sanctionLoanFromModule}>
                    <label>Customer</label>
                    <select value={loanCustomerId} onChange={e => setLoanCustomerId(e.target.value)} required>
                      <option value="">Select Customer</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name} - {c.email}</option>)}
                    </select>
                    <LoanFields loanForm={loanForm} setLoanForm={setLoanForm} />
                    <button>Sanction Loan</button>
                  </form>
                )}
              </div>
              <LoanRules />
            </div>

            <div className="card table-wrap">
              <div className="actions between"><h3>All Loans</h3><button className="secondary" onClick={openLoansModule}>Refresh</button></div>
              <LoanTable loans={allLoans} showCustomer />
            </div>
          </section>
        )}

        {view === 'customer' && selectedCustomer && (
          <section>
            <div className="actions between">
              <div>
                <h2>{selectedCustomer.name}</h2>
                <p className="muted">Customer login: {selectedCustomer.email}</p>
              </div>
              <button className="secondary" onClick={() => setView('customers')}>Back</button>
            </div>

            <div className="grid-2">
              <div className="card">
                <h3>Open Account</h3>
                <form onSubmit={openAccount}>
                  <label>Account Type</label>
                  <select value={accountForm.type} onChange={e => setAccountForm({ ...accountForm, type: e.target.value })}>
                    <option>SAVINGS</option><option>CURRENT</option>
                  </select>
                  <label>Opening Balance</label>
                  <input type="number" min="0" value={accountForm.balance} onChange={e => setAccountForm({ ...accountForm, balance: e.target.value })} />
                  <button>Open Account</button>
                </form>
              </div>
              <div className="card">
                <h3>Sanction Loan</h3>
                <form onSubmit={sanctionLoanFromCustomer}>
                  <LoanFields loanForm={loanForm} setLoanForm={setLoanForm} />
                  <button>Sanction Loan</button>
                </form>
              </div>
            </div>

            <div className="card table-wrap">
              <h3>Accounts</h3>
              <AccountTable accounts={accounts} showActions onMoney={money} />
            </div>
            <div className="card table-wrap">
              <h3>Customer Loans</h3>
              <LoanTable loans={customerLoans} />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function CustomerApplication({ username, role, onLogout }) {
  const [view, setView] = useState('dashboard');
  const [profile, setProfile] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loans, setLoans] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState(null);

  function showToast(title, detail) {
    setToast({ title, detail });
  }
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  useEffect(() => {
    loadMyData();
    loadNotifications();
  }, []);

  async function run(action) {
    setMessage('');
    try {
      await action();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function loadNotifications() {
    try {
      const [notificationData, countData] = await Promise.all([
        request('/customer/me/notifications'),
        request('/customer/me/notifications/unread-count')
      ]);
      setNotifications(notificationData);
      setUnreadCount(countData.count);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function markAllRead() {
    await run(async () => {
      await request('/customer/me/notifications/read-all', { method: 'POST' });
      await loadNotifications();
      setMessage('All notifications marked as read');
      showToast('Notifications updated', 'All saved notifications have been marked as read.');
    });
  }

  async function loadMyData() {
    await run(async () => {
      const [profileData, accountData, loanData] = await Promise.all([
        request('/customer/me'),
        request('/customer/me/accounts'),
        request('/customer/me/loans')
      ]);
      setProfile(profileData);
      setAccounts(accountData);
      setLoans(loanData);
    });
  }

  async function changePassword(e) {
    e.preventDefault();
    await run(async () => {
      if (passwordForm.newPassword !== passwordForm.confirmPassword) {
        throw new Error('New password and confirm password do not match');
      }
      await request('/customer/me/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        })
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMessage('Password changed successfully');
      showToast('Password changed', 'Your new password has been saved. Use it the next time you sign in.');
    });
  }

  async function customerMoney(accountId, operation) {
    const account = accounts.find(a => a.id === accountId);
    if (!account) {
      setMessage('Account not found');
      return;
    }

    const balanceText = Number(account.balance || 0).toLocaleString();
    const input = window.prompt(
      operation === 'withdraw'
        ? `Available balance: ₹${balanceText}\nEnter amount to withdraw:`
        : `Current balance: ₹${balanceText}\nEnter amount to deposit:`
    );

    if (input === null) return;

    const amount = Number(input);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Amount must be greater than zero');
      return;
    }

    // Friendly browser-side check. The backend repeats this check using BigDecimal,
    // so the balance rule cannot be bypassed by changing the React code.
    if (operation === 'withdraw' && amount > Number(account.balance || 0)) {
      setMessage(`Withdrawal denied. Available balance is ₹${balanceText}`);
      return;
    }

    await run(async () => {
      const updatedAccount = await request(`/customer/me/accounts/${accountId}/${operation}?amount=${encodeURIComponent(input)}`, {
        method: 'POST'
      });
      const updatedAccounts = await request('/customer/me/accounts');
      setAccounts(updatedAccounts);
      await loadNotifications();
      const action = operation === 'deposit'
        ? 'Deposit completed successfully'
        : 'Withdrawal completed successfully';
      setMessage(action);
      showToast(
        operation === 'deposit' ? 'Deposit successful' : 'Withdrawal successful',
        `₹${amount.toLocaleString()} • ${updatedAccount.accountNumber} • New balance ₹${Number(updatedAccount.balance).toLocaleString()}`
      );
    });
  }

  const totalBalance = accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const activeLoans = loans.filter(l => l.status === 'ACTIVE').length;

  return (
    <div>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <Header username={username} role={role} onLogout={onLogout}>
        <button className="nav-button" onClick={() => setView('dashboard')}>My Dashboard</button>
        <button className="nav-button" onClick={() => setView('accounts')}>My Accounts</button>
        <button className="nav-button loan-nav" onClick={() => setView('loans')}>My Loans</button>
        <button
          className="nav-button notification-nav"
          onClick={() => {
            loadNotifications();
            setView('notifications');
          }}
        >
          🔔 Notifications
          {unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}
        </button>
        <button className="nav-button" onClick={() => setView('password')}>Change Password</button>
      </Header>

      <main>
        <Message text={message} />

        {view === 'dashboard' && (
          <section>
            <h2>Customer Dashboard</h2>
            <div className="welcome-card card">
              <h3>Welcome{profile ? `, ${profile.name}` : ''}</h3>
              <p>This dashboard shows only your own AMC Bank information.</p>
            </div>
            <div className="stats">
              <Stat title="My Accounts" value={accounts.length} />
              <Stat title="Total Balance" value={`₹${totalBalance.toLocaleString()}`} />
              <Stat title="Active Loans" value={activeLoans} />
            </div>
            {profile && (
              <div className="card">
                <h3>My Profile</h3>
                <div className="profile-grid">
                  <div><span>Name</span><strong>{profile.name}</strong></div>
                  <div><span>Email / Login ID</span><strong>{profile.email}</strong></div>
                  <div><span>City</span><strong>{profile.city || '-'}</strong></div>
                  <div><span>PAN</span><strong>{profile.panNumber}</strong></div>
                </div>
              </div>
            )}
          </section>
        )}

        {view === 'accounts' && (
          <section>
            <h2>My Accounts</h2>
            <div className="card">
              <h3>Deposit / Withdraw</h3>
              <p className="muted">Use the buttons beside your account. Withdrawal is allowed only when the requested amount is less than or equal to the available balance.</p>
            </div>
            <div className="card table-wrap">
              <AccountTable accounts={accounts} showActions onMoney={customerMoney} />
            </div>
            <p className="hint">For security, you can transact only on accounts linked to your own customer login. The backend validates account ownership and available balance.</p>
          </section>
        )}

        {view === 'loans' && (
          <section>
            <h2>My Loans</h2>
            <div className="card table-wrap">
              <LoanTable loans={loans} />
            </div>
            <p className="hint">Customers can view their own loans and EMI. Loan sanctioning remains an admin operation.</p>
          </section>
        )}

        {view === 'notifications' && (
          <section>
            <div className="notification-header">
              <div>
                <h2>🔔 Notifications</h2>
                <p className="muted">Recent activity and alerts from AMC Bank.</p>
              </div>
              {notifications.length > 0 && (
                <button className="secondary" onClick={markAllRead}>Mark All as Read</button>
              )}
            </div>

            <div className="card">
              {notifications.length === 0 ? (
                <div className="empty-notifications">
                  <div className="empty-icon">🔔</div>
                  <h3>No Notifications</h3>
                  <p className="muted">Your transaction notifications will appear here.</p>
                </div>
              ) : (
                <div className="notification-list">
                  {notifications.map(n => (
                    <div
                      key={n.id}
                      className={n.readStatus ? 'notification-item read' : 'notification-item unread'}
                    >
                      <div className="notification-icon">{n.type === 'DEPOSIT' ? '💰' : '💸'}</div>
                      <div className="notification-content">
                        <strong>{n.type === 'DEPOSIT' ? 'Deposit Alert' : 'Withdrawal Alert'}</strong>
                        <p>{n.message}</p>
                        {n.amount != null && <small className="notification-details">Amount: ₹{Number(n.amount).toLocaleString()} · Balance after: ₹{Number(n.balanceAfter).toLocaleString()}</small>}
                        <small>{new Date(n.createdAt).toLocaleString()}</small>
                      </div>
                      {!n.readStatus && <span className="unread-dot"></span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {view === 'password' && (
          <section className="narrow-section">
            <h2>Change Password</h2>
            <div className="card">
              <p className="muted">Enter the first/current password created by the admin, then choose your new password.</p>
              <form onSubmit={changePassword}>
                <label>Current Password</label>
                <input type="password" value={passwordForm.currentPassword} onChange={e => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} required />
                <label>New Password</label>
                <input type="password" minLength="6" value={passwordForm.newPassword} onChange={e => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} required />
                <label>Confirm New Password</label>
                <input type="password" minLength="6" value={passwordForm.confirmPassword} onChange={e => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} required />
                <button>Change Password</button>
              </form>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Header({ username, role, onLogout, children }) {
  return (
    <header>
      <div><strong>AMC Bank</strong> <span className="muted-light">{username} · {role}</span></div>
      <nav>{children}<button className="nav-button" onClick={onLogout}>Logout</button></nav>
    </header>
  );
}

function Message({ text }) {
  if (!text) return null;
  const good = text.toLowerCase().includes('success') || text.includes('completed') || text.includes('deleted') || text.includes('marked as read');
  return <div className={good ? 'success' : 'error-box'}>{text}</div>;
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(onClose, 5500);
    return () => window.clearTimeout(timeout);
  }, [toast, onClose]);

  if (!toast) return null;

  return (
    <div className="transaction-toast" role="status" aria-live="polite">
      <div className="toast-icon">✓</div>
      <div><strong>{toast.title}</strong><span>{toast.detail}</span></div>
      <button className="toast-close" aria-label="Close notification" onClick={onClose}>×</button>
    </div>
  );
}

function Stat({ title, value }) {
  return <div className="card stat"><div className="stat-value">{value}</div><div>{title}</div></div>;
}

function LoanFields({ loanForm, setLoanForm }) {
  return (
    <>
      <label>Loan Type</label>
      <select value={loanForm.type} onChange={e => setLoanForm({ ...loanForm, type: e.target.value })}>
        <option>HOME</option><option>CAR</option><option>PERSONAL</option>
      </select>
      <label>Principal Amount</label>
      <input type="number" min="10000" value={loanForm.principal} onChange={e => setLoanForm({ ...loanForm, principal: e.target.value })} required />
      <label>Interest Rate (%)</label>
      <input type="number" min="0.1" max="50" step="0.1" value={loanForm.interestRate} onChange={e => setLoanForm({ ...loanForm, interestRate: e.target.value })} required />
      <label>Tenure (Months)</label>
      <input type="number" min="1" max="480" value={loanForm.tenureMonths} onChange={e => setLoanForm({ ...loanForm, tenureMonths: e.target.value })} required />
    </>
  );
}

function LoanRules() {
  return (
    <div className="card loan-rules">
      <h3>AMC Bank Loan Rules</h3>
      <p><strong>Rule 1:</strong> Minimum loan principal is ₹10,000.</p>
      <p><strong>Rule 2:</strong> A customer can have a maximum of 3 ACTIVE loans.</p>
      <p><strong>Rule 3:</strong> Active account balance must be at least 10% of the requested principal.</p>
    </div>
  );
}

function AccountTable({ accounts, showActions = false, onMoney }) {
  return (
    <table>
      <thead><tr><th>Account No.</th><th>Type</th><th>Balance</th><th>Status</th>{showActions && <th>Actions</th>}</tr></thead>
      <tbody>
        {accounts.map(a => (
          <tr key={a.id}>
            <td>{a.accountNumber}</td><td>{a.type}</td><td>₹{Number(a.balance).toLocaleString()}</td><td>{a.status}</td>
            {showActions && <td className="actions"><button onClick={() => onMoney(a.id, 'deposit')}>Deposit</button><button className="secondary" onClick={() => onMoney(a.id, 'withdraw')}>Withdraw</button></td>}
          </tr>
        ))}
        {accounts.length === 0 && <tr><td colSpan={showActions ? 5 : 4}>No accounts yet.</td></tr>}
      </tbody>
    </table>
  );
}

function LoanTable({ loans, showCustomer = false }) {
  return (
    <table>
      <thead>
        <tr>{showCustomer && <th>Customer</th>}<th>Type</th><th>Principal</th><th>Rate</th><th>Months</th><th>EMI</th><th>Status</th></tr>
      </thead>
      <tbody>
        {loans.map(l => (
          <tr key={l.id}>
            {showCustomer && <td>{l.customerName || `Customer #${l.customerId}`}</td>}
            <td>{l.type}</td><td>₹{Number(l.principal).toLocaleString()}</td><td>{l.interestRate}%</td><td>{l.tenureMonths}</td><td>₹{Number(l.emi).toLocaleString()}</td><td>{l.status}</td>
          </tr>
        ))}
        {loans.length === 0 && <tr><td colSpan={showCustomer ? 7 : 6}>No loans yet.</td></tr>}
      </tbody>
    </table>
  );
}
