document.addEventListener('DOMContentLoaded', () => {
  // 仪表盘相关元素
  const accountsStatusList = document.getElementById('accounts-status-list');
  const onlineAccountsCount = document.getElementById('online-accounts-count');
  const loginSuccessCount = document.getElementById('login-success-count');
  const soldOutCount = document.getElementById('soldout-count');
  const soldOutTotal = document.getElementById('soldout-total');
  const pushSalesBtn = document.getElementById('push-sales-btn');

  // 系统监控相关元素
  const refreshSystemBtn = document.getElementById('refresh-system-btn');
  const heapUsed = document.getElementById('heap-used');
  const heapTotal = document.getElementById('heap-total');
  const externalMemory = document.getElementById('external-memory');
  const uptime = document.getElementById('uptime');
  const activeWorkers = document.getElementById('active-workers');
  const enabledAccounts = document.getElementById('enabled-accounts');
  const loginInterval = document.getElementById('login-interval');
  const soldoutInterval = document.getElementById('soldout-interval');
  const salesInterval = document.getElementById('sales-interval');

  // 推送设置相关元素
  const pushSchedule = document.getElementById('push-schedule');
  const quietHours = document.getElementById('quiet-hours');
  const pushCheckInterval = document.getElementById('push-check-interval');
  
  // 售罄相关元素
  const allSoldOutList = document.getElementById('all-soldout-list').querySelector('tbody');
  
  // 账号管理相关元素
  const accountsCount = document.getElementById('accounts-count');
  const addAccountForm = document.getElementById('add-account-form');
  const accountsTable = document.getElementById('accounts-table').querySelector('tbody');
  
  // 标签页相关元素
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  // 存储所有账号的状态
  let accountsStatus = {};
  
  // 存储所有账号的数据
  let accountsList = [];
  
  // 存储当前打开的账号面板
  let openAccountPanels = [];

  // 初始化标签页切换
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // 移除所有标签页和内容区的active类
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      // 添加当前标签页和内容区的active类
      tab.classList.add('active');
      const tabId = tab.getAttribute('data-tab');
      document.getElementById(`${tabId}-tab`).classList.add('active');
      
      // 如果切换到账号管理标签页，刷新账号列表
      if (tabId === 'accounts') {
        fetchAccounts();
      } else if (tabId === 'soldout') {
        fetchAllSoldOut();
      } else if (tabId === 'dashboard') {
        fetchAccountsStatus();
      } else if (tabId === 'system') {
        fetchSystemStatus();
      }
    });
  });

  // 格式化时间
  function formatDateTime(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN');
  }

  // 格式化倒计时
  function formatCountdown(seconds) {
    if (seconds === undefined || seconds === null) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // 格式化token为缩略显示
  function formatToken(token) {
    if (!token) return '-';
    if (token.length <= 12) return token;
    return token.substring(0, 6) + '...' + token.substring(token.length - 6);
  }

  // 获取所有账号状态
  async function fetchAccountsStatus() {
    try {
      const response = await fetch('/api/accounts-status');
      const newAccountsStatus = await response.json();
      
      // 检查是否有账号被删除
      const currentIds = Object.keys(newAccountsStatus);
      const previousIds = Object.keys(accountsStatus);
      
      // 检测删除的账号
      const deletedIds = previousIds.filter(id => !currentIds.includes(id));
      if (deletedIds.length > 0) {
        // 有账号被删除，需要同步更新账号列表
        await fetchAccounts();
      }
      
      // 更新状态
      accountsStatus = newAccountsStatus;
      
      // 更新状态汇总信息
      updateStatusSummary();
      
      // 更新账号状态面板
      renderAccountStatusPanels();
      
      return accountsStatus;
    } catch (error) {
      console.error('获取账号状态失败:', error);
      return {};
    }
  }

  // 更新状态汇总信息
  function updateStatusSummary() {
    const accountIds = Object.keys(accountsStatus);
    const totalAccounts = accountIds.length;
    
    // 计算登录成功的账号数量
    const successfulLogins = accountIds.filter(id => 
      accountsStatus[id].loginStatus && accountsStatus[id].loginStatus.success
    ).length;
    
    // 更新在线账号和登录成功数量
    onlineAccountsCount.textContent = totalAccounts;
    loginSuccessCount.textContent = successfulLogins;
    
    // 如果有售罄商品，更新售罄数量
    const soldOutItems = accountIds.filter(id => 
      accountsStatus[id].soldOutStatus && 
      accountsStatus[id].soldOutStatus.goodsId
    ).length;
    
    soldOutCount.textContent = soldOutItems;
    soldOutTotal.textContent = soldOutItems;
  }

  // 渲染账号状态面板
  function renderAccountStatusPanels() {
    accountsStatusList.innerHTML = '';
    
    // 如果没有账号状态，显示提示信息
    if (Object.keys(accountsStatus).length === 0) {
      const noAccount = document.createElement('div');
      noAccount.className = 'info-line';
      noAccount.innerHTML = '<p>暂无账号状态信息，请先添加并启用账号</p>';
      accountsStatusList.appendChild(noAccount);
      return;
    }
    
    // 查找对应账号的详细信息
    const accountsMap = {};
    accountsList.forEach(acc => {
      accountsMap[acc.id] = acc;
    });
    
    // 清理已删除账号的状态
    for (const id in accountsStatus) {
      if (!accountsMap[id]) {
        // 该账号在账号列表中不存在，应该是已被删除的账号
        delete accountsStatus[id];
      }
    }
    
    // 为每个账号创建状态面板
    for (const id in accountsStatus) {
      const status = accountsStatus[id];
      // 确保账号在账号列表中存在，防止显示已删除的账号
      const account = accountsMap[id];
      if (!account) continue;
      
      // 创建账号面板
      const panel = document.createElement('div');
      panel.className = 'account-panel';
      
      // 账号面板头部
      const header = document.createElement('div');
      header.className = 'account-header';
      
      // 登录状态标签
      let loginStatusClass = 'neutral';
      let loginStatusText = '等待登录';
      
      if (status.loginStatus.success) {
        loginStatusClass = 'success';
        loginStatusText = '登录成功';
      } else if (status.loginStatus.timestamp) {
        loginStatusClass = 'error';
        loginStatusText = '登录失败';
      }
      
      // 售罄状态标签
      let soldoutStatusClass = 'neutral';
      let soldoutStatusText = '无售罄';
      
      if (status.soldOutStatus && status.soldOutStatus.goodsId) {
        if (status.soldOutStatus.onShelfStatus === '成功') {
          soldoutStatusClass = 'success';
          soldoutStatusText = '已上架';
        } else if (status.soldOutStatus.onShelfStatus === '失败') {
          soldoutStatusClass = 'error';
          soldoutStatusText = '上架失败';
        } else {
          soldoutStatusClass = 'warning';
          soldoutStatusText = '发现售罄';
        }
      }
      
      // 销售数据显示
      let salesDisplay = '';
      if (status.salesStatus && status.salesStatus.success) {
        salesDisplay = `<span class="badge">订单:${status.salesStatus.todayOrders}</span><span class="badge">¥${status.salesStatus.todayAmount}</span>`;
      }

      header.innerHTML = `
        <h3>账号: ${status.loginStatus.account} ${salesDisplay}</h3>
        <div>
          <span class="status ${loginStatusClass}">${loginStatusText}</span>
          <span class="status ${soldoutStatusClass}">${soldoutStatusText}</span>
          <button class="small login-btn" data-id="${id}">登录</button>
        </div>
      `;
      
      // 账号面板内容
      const body = document.createElement('div');
      body.className = 'account-body';
      if (openAccountPanels.includes(id)) {
        body.className += ' active';
      }
      
      // 登录状态信息
      const loginInfo = status.loginStatus;
      const loginSection = document.createElement('div');
      loginSection.className = 'flex-container';
      loginSection.innerHTML = `
        <div class="flex-item">
          <h3>登录信息</h3>
          <div class="info-line">
            <div class="info-label">用户名:</div>
            <div class="info-value">${loginInfo.real_name || '-'}</div>
          </div>
          <div class="info-line">
            <div class="info-label">状态消息:</div>
            <div class="info-value">${loginInfo.msg || '-'}</div>
          </div>
          <div class="info-line">
            <div class="info-label">上次更新:</div>
            <div class="info-value">${formatDateTime(loginInfo.timestamp)}</div>
          </div>
          <div class="info-line">
            <div class="info-label">Token:</div>
            <div class="info-value token-preview" title="${loginInfo.token || ''}">${formatToken(loginInfo.token)}</div>
          </div>
          <div class="countdown">下次登录: 剩余 ${formatCountdown(status.loginCountdown)}</div>
        </div>
      `;
      
      // 售罄监控信息
      const soldOutInfo = status.soldOutStatus;
      const soldOutSection = document.createElement('div');
      soldOutSection.className = 'flex-item';
      
      let soldOutContent = `
        <h3>售罄监控</h3>
        <div class="countdown">下次检查: 剩余 ${formatCountdown(status.soldOutCountdown)}</div>
      `;
      
      // 如果发现售罄商品
      if (soldOutInfo && soldOutInfo.goodsId) {
        let onShelfStatusText = '等待处理';
        let onShelfStatusColor = '';
        
        if (soldOutInfo.onShelfStatus === '成功') {
          onShelfStatusText = '上架成功';
          onShelfStatusColor = '#4caf50';
        } else if (soldOutInfo.onShelfStatus === '失败') {
          onShelfStatusText = `上架失败: ${soldOutInfo.onShelfMessage || ''}`;
          onShelfStatusColor = '#f44336';
        }
        
        soldOutContent += `
          <div class="soldout-item">
            <div class="info-line">
              <div class="info-label">售罄ID:</div>
              <div class="info-value highlight">${soldOutInfo.goodsId}</div>
            </div>
            <div class="info-line">
              <div class="info-label">上架状态:</div>
              <div class="info-value" style="color:${onShelfStatusColor}">${onShelfStatusText}</div>
            </div>
            <div class="info-line">
              <div class="info-label">发现时间:</div>
              <div class="info-value">${formatDateTime(soldOutInfo.timestamp)}</div>
            </div>
          </div>
        `;
      } else {
        soldOutContent += `
          <div class="info-line">
            <div class="info-value">暂未发现售罄商品</div>
          </div>
        `;
      }
      
      soldOutSection.innerHTML = soldOutContent;

      // 销售数据信息
      const salesInfo = status.salesStatus;
      const salesSection = document.createElement('div');
      salesSection.className = 'flex-item';

      let salesContent = `
        <h3>今日销售</h3>
      `;

      // 如果有销售数据
      if (salesInfo && salesInfo.success) {
        salesContent += `
          <div class="info-line">
            <div class="info-label">订单数:</div>
            <div class="info-value highlight">${salesInfo.todayOrders}</div>
          </div>
          <div class="info-line">
            <div class="info-label">销售额:</div>
            <div class="info-value highlight">¥${salesInfo.todayAmount}</div>
          </div>
          <div class="info-line">
            <div class="info-label">更新时间:</div>
            <div class="info-value">${formatDateTime(salesInfo.timestamp)}</div>
          </div>
        `;
      } else {
        salesContent += `
          <div class="info-line">
            <div class="info-value">暂无销售数据</div>
          </div>
        `;
      }

      salesSection.innerHTML = salesContent;

      // 添加各部分到面板内容
      body.appendChild(loginSection);
      body.appendChild(soldOutSection);
      body.appendChild(salesSection);
      
      // 添加头部和内容到面板
      panel.appendChild(header);
      panel.appendChild(body);
      
      // 添加面板到列表
      accountsStatusList.appendChild(panel);
      
      // 添加面板切换点击事件
      header.addEventListener('click', (e) => {
        // 如果点击的是按钮，不切换面板
        if (e.target.tagName === 'BUTTON') {
          return;
        }
        
        const panelBody = header.nextElementSibling;
        panelBody.classList.toggle('active');
        
        // 更新打开的面板列表
        if (panelBody.classList.contains('active')) {
          if (!openAccountPanels.includes(id)) {
            openAccountPanels.push(id);
          }
        } else {
          openAccountPanels = openAccountPanels.filter(panelId => panelId !== id);
        }
      });
    }
    
    // 为登录按钮添加点击事件
    document.querySelectorAll('.login-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        manualLogin(id);
      });
    });
  }

  // 获取账号列表
  async function fetchAccounts() {
    try {
      const response = await fetch('/api/accounts');
      const accounts = await response.json();
      accountsList = accounts; // 保存账号列表
      updateAccountsUI(accounts);
      return accounts;
    } catch (error) {
      console.error('获取账号列表失败:', error);
      accountsCount.textContent = '获取失败';
      return [];
    }
  }

  // 获取所有售罄商品信息
  async function fetchAllSoldOut() {
    try {
      const response = await fetch('/api/all-soldout');
      const data = await response.json();
      
      // 更新售罄商品列表
      updateAllSoldOutList(data);
      
      return data;
    } catch (error) {
      console.error('获取所有售罄商品信息失败:', error);
      return { success: false, total: 0, data: [] };
    }
  }

  // 更新所有售罄商品列表
  function updateAllSoldOutList(data) {
    // 清空表格
    allSoldOutList.innerHTML = '';
    
    if (!data.success || data.total === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = '暂无售罄商品';
      cell.style.textAlign = 'center';
      row.appendChild(cell);
      allSoldOutList.appendChild(row);
      return;
    }
    
    // 添加所有售罄商品
    data.data.forEach(item => {
      const row = document.createElement('tr');
      
      // 账号列
      const accountCell = document.createElement('td');
      accountCell.textContent = item.account || '-';
      row.appendChild(accountCell);
      
      // 商品ID列
      const goodsIdCell = document.createElement('td');
      goodsIdCell.textContent = item.goodsId || '-';
      goodsIdCell.style.fontWeight = 'bold';
      row.appendChild(goodsIdCell);
      
      // 上架状态列
      const statusCell = document.createElement('td');
      if (item.onShelfStatus === '成功') {
        statusCell.textContent = '上架成功';
        statusCell.style.color = '#4caf50';
      } else if (item.onShelfStatus === '失败') {
        statusCell.textContent = `上架失败: ${item.onShelfMessage || ''}`;
        statusCell.style.color = '#f44336';
      } else {
        statusCell.textContent = '等待处理';
      }
      row.appendChild(statusCell);
      
      // 发现时间列
      const timeCell = document.createElement('td');
      timeCell.textContent = formatDateTime(item.timestamp);
      row.appendChild(timeCell);
      
      // 操作列
      const actionsCell = document.createElement('td');
      const viewBtn = document.createElement('button');
      viewBtn.textContent = '查看账号';
      viewBtn.className = 'small';
      viewBtn.addEventListener('click', () => {
        // 切换到仪表盘标签页
        document.querySelector('.tab[data-tab="dashboard"]').click();
        
        // 延迟一下等待仪表盘加载
        setTimeout(() => {
          // 找到对应的账号面板
          const panel = accountsStatusList.querySelector(`.account-panel:nth-child(${parseInt(item.accountId)})`);
          if (panel) {
            // 展开面板
            const body = panel.querySelector('.account-body');
            if (body && !body.classList.contains('active')) {
              panel.querySelector('.account-header').click();
            }
            
            // 滚动到面板位置
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 300);
      });
      actionsCell.appendChild(viewBtn);
      row.appendChild(actionsCell);
      
      allSoldOutList.appendChild(row);
    });
  }

  // 更新账号列表UI
  function updateAccountsUI(accounts) {
    // 清空表格
    accountsTable.innerHTML = '';
    
    // 更新账号总数
    accountsCount.textContent = accounts.length;
    
    // 为每个账号创建表格行
    accounts.forEach(account => {
      const row = document.createElement('tr');
      
      // ID列
      const idCell = document.createElement('td');
      idCell.textContent = account.id;
      row.appendChild(idCell);
      
      // 账号列
      const accountCell = document.createElement('td');
      accountCell.textContent = account.account;
      row.appendChild(accountCell);
      
      // 启用状态列
      const enabledCell = document.createElement('td');
      const toggleSwitch = document.createElement('label');
      toggleSwitch.className = 'toggle-switch';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = account.enabled;
      checkbox.addEventListener('change', () => updateAccountStatus(account.id, checkbox.checked));
      
      const slider = document.createElement('span');
      slider.className = 'slider';
      
      toggleSwitch.appendChild(checkbox);
      toggleSwitch.appendChild(slider);
      enabledCell.appendChild(toggleSwitch);
      row.appendChild(enabledCell);
      
      // 登录状态列
      const loginStatusCell = document.createElement('td');
      if (accountsStatus[account.id]) {
        const loginStatus = accountsStatus[account.id].loginStatus;
        const statusSpan = document.createElement('span');
        
        if (loginStatus.success) {
          statusSpan.className = 'status success';
          statusSpan.textContent = '在线';
        } else if (loginStatus.timestamp) {
          statusSpan.className = 'status error';
          statusSpan.textContent = '失败';
        } else {
          statusSpan.className = 'status neutral';
          statusSpan.textContent = '等待';
        }
        
        loginStatusCell.appendChild(statusSpan);
      } else {
        loginStatusCell.textContent = '未知';
      }
      row.appendChild(loginStatusCell);
      
      // 上次使用时间列
      const lastUsedCell = document.createElement('td');
      lastUsedCell.textContent = account.lastUsed ? formatDateTime(account.lastUsed) : '从未使用';
      row.appendChild(lastUsedCell);
      
      // 操作列
      const actionsCell = document.createElement('td');
      
      // 查看按钮
      const viewBtn = document.createElement('button');
      viewBtn.textContent = '查看状态';
      viewBtn.className = 'blue';
      viewBtn.style.marginRight = '5px';
      viewBtn.addEventListener('click', () => {
        // 切换到仪表盘标签页
        document.querySelector('.tab[data-tab="dashboard"]').click();
        
        // 延迟一下等待仪表盘加载
        setTimeout(() => {
          // 找到对应的账号面板
          const panels = accountsStatusList.querySelectorAll('.account-panel');
          for (let i = 0; i < panels.length; i++) {
            const panelHeader = panels[i].querySelector('.account-header');
            if (panelHeader.textContent.includes(account.account)) {
              // 展开面板
              const body = panels[i].querySelector('.account-body');
              if (body && !body.classList.contains('active')) {
                panelHeader.click();
              }
              
              // 滚动到面板位置
              panels[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
              break;
            }
          }
        }, 300);
      });
      
      // 手动登录按钮
      const loginBtn = document.createElement('button');
      loginBtn.textContent = '立即登录';
      loginBtn.style.marginRight = '5px';
      loginBtn.addEventListener('click', () => manualLogin(account.id));
      
      // 删除按钮
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '删除';
      deleteBtn.className = 'delete';
      deleteBtn.addEventListener('click', () => deleteAccount(account.id));
      
      actionsCell.appendChild(viewBtn);
      actionsCell.appendChild(loginBtn);
      actionsCell.appendChild(deleteBtn);
      row.appendChild(actionsCell);
      
      // 添加行到表格
      accountsTable.appendChild(row);
    });
  }

  // 添加新账号
  async function addAccount(account, pwd) {
    try {
      const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ account, pwd })
      });
      
      const result = await response.json();
      
      if (response.ok) {
        alert('账号添加成功');
        fetchAccounts(); // 刷新账号列表
      } else {
        alert(`添加失败: ${result.message || '未知错误'}`);
      }
    } catch (error) {
      console.error('添加账号失败:', error);
      alert('添加账号失败，请查看控制台了解详情');
    }
  }

  // 删除账号
  async function deleteAccount(id) {
    if (!confirm(`确定要删除ID为 ${id} 的账号吗？`)) {
      return;
    }
    
    try {
      const response = await fetch(`/api/accounts/${id}`, {
        method: 'DELETE'
      });
      
      const result = await response.json();
      
      if (response.ok) {
        alert('账号删除成功');
        // 先清除本地缓存中的账号状态
        if (accountsStatus[id]) {
          delete accountsStatus[id];
        }
        // 再重新获取最新账号列表和状态
        await fetchAccounts(); // 刷新账号列表
        await fetchAccountsStatus(); // 刷新账号状态
        // 重新渲染状态面板以反映删除结果
        renderAccountStatusPanels();
      } else {
        alert(`删除失败: ${result.message || '未知错误'}`);
      }
    } catch (error) {
      console.error('删除账号失败:', error);
      alert('删除账号失败，请查看控制台了解详情');
    }
  }

  // 更新账号状态
  async function updateAccountStatus(id, enabled) {
    try {
      const response = await fetch(`/api/accounts/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled })
      });
      
      const result = await response.json();
      
      if (response.ok) {
        // 短暂延迟后获取更新后的账号状态
        setTimeout(() => {
          fetchAccountsStatus();
          fetchAccounts();
        }, 1000);
      } else {
        alert(`更新失败: ${result.message || '未知错误'}`);
        fetchAccounts(); // 刷新账号列表以恢复状态
      }
    } catch (error) {
      console.error('更新账号状态失败:', error);
      alert('更新账号状态失败，请查看控制台了解详情');
      fetchAccounts(); // 刷新账号列表以恢复状态
    }
  }

  // 手动触发特定账号登录
  async function manualLogin(id) {
    try {
      const response = await fetch(`/api/login/${id}`, {
        method: 'POST'
      });
      
      const result = await response.json();
      
      if (response.ok) {
        alert('已触发登录请求');
        
        // 短暂延迟后获取更新后的账号状态
        setTimeout(() => {
          fetchAccountsStatus();
        }, 1000);
      } else {
        alert(`触发登录失败: ${result.message || '未知错误'}`);
      }
    } catch (error) {
      console.error('手动登录失败:', error);
      alert('手动登录失败，请查看控制台了解详情');
    }
  }

  // 注册事件监听器
  addAccountForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const account = document.getElementById('account').value.trim();
    const pwd = document.getElementById('pwd').value.trim();
    
    if (account && pwd) {
      addAccount(account, pwd);
      addAccountForm.reset();
    }
  });

  // 初始化：获取账号列表
  fetchAccounts();
  
  // 初始化：获取账号状态
  fetchAccountsStatus();
  
  // 初始化：获取所有售罄商品信息
  fetchAllSoldOut();

  // 优化前端请求频率 - 减少服务器压力
  // 每5秒更新账号状态（从3秒增加到5秒）
  setInterval(() => {
    fetchAccountsStatus();
  }, 5000);

  // 每15秒获取所有售罄商品信息（从10秒增加到15秒）
  setInterval(() => {
    fetchAllSoldOut();
  }, 15000);

  // 推送销售数据功能
  async function pushSalesData() {
    try {
      pushSalesBtn.disabled = true;
      pushSalesBtn.textContent = '推送中...';

      const response = await fetch('/api/push-sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();

      if (result.success) {
        alert('销售数据推送成功！');
      } else {
        alert('推送失败: ' + result.message);
      }
    } catch (error) {
      console.error('推送销售数据失败:', error);
      alert('推送失败: ' + error.message);
    } finally {
      pushSalesBtn.disabled = false;
      pushSalesBtn.textContent = '推送销售数据';
    }
  }

  // 获取系统状态
  async function fetchSystemStatus() {
    try {
      const response = await fetch('/api/system-status');
      const result = await response.json();

      if (result.success) {
        const data = result.data;

        // 更新内存信息
        heapUsed.textContent = data.memory.heapUsed;
        heapTotal.textContent = data.memory.heapTotal;
        externalMemory.textContent = data.memory.external;

        // 更新系统信息
        uptime.textContent = data.uptime;
        activeWorkers.textContent = data.activeWorkers;
        enabledAccounts.textContent = `${data.enabledAccounts}/${data.totalAccounts}`;

        // 更新间隔信息
        loginInterval.textContent = data.intervals.login;
        soldoutInterval.textContent = data.intervals.soldOutCheck;
        salesInterval.textContent = data.intervals.salesCheck;

        // 更新推送设置信息
        if (data.pushSettings) {
          pushSchedule.textContent = data.pushSettings.schedule;
          quietHours.textContent = data.pushSettings.quietHours;
          pushCheckInterval.textContent = data.pushSettings.checkInterval;
        }
      }
    } catch (error) {
      console.error('获取系统状态失败:', error);
    }
  }

  // 绑定推送按钮事件
  if (pushSalesBtn) {
    pushSalesBtn.addEventListener('click', pushSalesData);
  }

  // 绑定系统监控刷新按钮事件
  if (refreshSystemBtn) {
    refreshSystemBtn.addEventListener('click', fetchSystemStatus);
  }
}); 