const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// 检查并安装依赖
function checkAndInstallDependencies() {
  const requiredDependencies = ['express', 'axios', 'cors'];
  let needToInstall = false;
  let missingDeps = [];
  
  console.log('正在检查运行依赖...');
  
  // 检查package.json是否存在
  try {
    if (fs.existsSync('package.json')) {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      
      // 检查是否所有依赖都已安装
      for (const dep of requiredDependencies) {
        if (!packageJson.dependencies || !packageJson.dependencies[dep]) {
          missingDeps.push(dep);
          needToInstall = true;
        }
      }
    } else {
      // 创建package.json
      console.log('未找到package.json，将创建并安装所需依赖');
      execSync('npm init -y');
      needToInstall = true;
      missingDeps = [...requiredDependencies];
    }
    
    // 安装缺失的依赖
    if (needToInstall) {
      if (missingDeps.length > 0) {
        console.log(`缺少以下依赖: ${missingDeps.join(', ')}`);
      }
      console.log('正在安装依赖，请稍候...');
      execSync('npm install express axios cors --save', { stdio: 'inherit' });
      console.log('依赖安装完成！');
    } else {
      console.log('所有依赖已安装，启动服务器...');
    }
  } catch (error) {
    console.error('安装依赖时出错:', error.message);
    console.error('请手动运行: npm install express axios cors --save');
    process.exit(1);
  }
}

// 如果是主线程，启动服务器
if (isMainThread) {
  // 运行依赖检查
  checkAndInstallDependencies();

  const express = require('express');
  const axios = require('axios');
  const cors = require('cors');

  const app = express();
  const PORT = process.env.PORT || 3006;

  // 账号配置文件路径
  const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');

  // 初始化账号列表
  let accounts = [];

  // 存储所有账号的状态
  let accountsStatus = {};

  // 存储所有工作线程
  const workers = {};

  // 设置定时任务间隔时间（毫秒）- 优化后减少请求频率
  const LOGIN_INTERVAL = 15 * 60 * 1000; // 15分钟（从10分钟增加到15分钟）
  const SOLD_OUT_CHECK_INTERVAL = 10 * 1000; // 10秒（从5秒增加到10秒）
  const SALES_CHECK_INTERVAL = 30 * 1000; // 30秒查询销售数据（独立间隔）
  const PUSH_CHECK_INTERVAL = 60 * 1000; // 每分钟检查是否需要推送

  // 请求限制配置
  const REQUEST_TIMEOUT = 10000; // 10秒请求超时
  const MAX_CONCURRENT_REQUESTS = 3; // 最大并发请求数

  // 推送配置
  const PUSH_CONFIG = {
    token: '66481a4cd4e14b66bca5d38b7012d254',
    topic: 'yudian',
    template: 'html'
  };

  // 加载账号列表
  function loadAccounts() {
    try {
      if (fs.existsSync(ACCOUNTS_FILE)) {
        accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
        console.log(`已加载${accounts.length}个账号`);
      } else {
        // 创建默认账号配置
        accounts = [
          {
            id: 1,
            account: "17606502347",
            pwd: "1505843894",
            enabled: true,
            lastUsed: null
          }
        ];
        saveAccounts();
        console.log('已创建默认账号配置文件');
      }
    } catch (error) {
      console.error('加载账号配置失败:', error.message);
      // 使用默认账号
      accounts = [
        {
          id: 1,
          account: "17606502347",
          pwd: "1505843894",
          enabled: true,
          lastUsed: null
        }
      ];
    }
  }

  // 保存账号列表
  function saveAccounts() {
    try {
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
      console.log('账号配置已保存');
    } catch (error) {
      console.error('保存账号配置失败:', error.message);
    }
  }

  // 为每个启用的账号创建工作线程
  function startWorkersForAccounts() {
    // 先终止所有现有工作线程
    for (const id in workers) {
      if (workers[id]) {
        try {
          workers[id].terminate();
          console.log(`终止账号 ${id} 的工作线程`);
        } catch (e) {
          console.error(`终止账号 ${id} 的工作线程失败:`, e.message);
        }
      }
    }

    // 初始化账号状态
    accountsStatus = {};

    // 为每个启用的账号创建新的工作线程
    const enabledAccounts = accounts.filter(acc => acc.enabled === true);
    
    for (const account of enabledAccounts) {
      startWorkerForAccount(account);
    }

    console.log(`已启动 ${enabledAccounts.length} 个账号的工作线程`);
  }

  // 为单个账号启动工作线程
  function startWorkerForAccount(account) {
    try {
      const worker = new Worker(__filename, {
        workerData: {
          account: account,
          loginInterval: LOGIN_INTERVAL,
          soldOutCheckInterval: SOLD_OUT_CHECK_INTERVAL,
          salesCheckInterval: SALES_CHECK_INTERVAL,
          requestTimeout: REQUEST_TIMEOUT
        }
      });

      // 初始化该账号的状态
      accountsStatus[account.id] = {
        loginStatus: {
          timestamp: null,
          success: false,
          msg: '等待登录',
          real_name: '',
          token: '',
          account: account.account
        },
        soldOutStatus: {
          timestamp: null,
          success: false,
          goodsId: '',
          onShelfStatus: '',
          onShelfMessage: ''
        },
        salesStatus: {
          timestamp: null,
          success: false,
          todayOrders: 0,
          todayAmount: 0
        },
        loginCountdown: LOGIN_INTERVAL / 1000,
        soldOutCountdown: SOLD_OUT_CHECK_INTERVAL / 1000
      };

      // 监听工作线程发送的消息
      worker.on('message', message => {
        if (message.type === 'login_result') {
          accountsStatus[account.id].loginStatus = message.data;
          // 更新账号的最后使用时间
          const accIndex = accounts.findIndex(a => a.id === account.id);
          if (accIndex !== -1) {
            accounts[accIndex].lastUsed = new Date().toISOString();
            saveAccounts();
          }
        } else if (message.type === 'soldout_result') {
          accountsStatus[account.id].soldOutStatus = message.data;
        } else if (message.type === 'sales_result') {
          accountsStatus[account.id].salesStatus = message.data;
        } else if (message.type === 'countdown') {
          accountsStatus[account.id].loginCountdown = message.data.loginCountdown;
          accountsStatus[account.id].soldOutCountdown = message.data.soldOutCountdown;
        } else if (message.type === 'log') {
          console.log(`[账号${account.id}] ${message.data}`);
        }
      });

      worker.on('error', error => {
        console.error(`账号 ${account.id} 的工作线程出错:`, error);
        accountsStatus[account.id].loginStatus.success = false;
        accountsStatus[account.id].loginStatus.msg = `线程错误: ${error.message}`;
      });

      worker.on('exit', code => {
        if (code !== 0) {
          console.log(`账号 ${account.id} 的工作线程异常退出，代码: ${code}`);
          // 尝试重启线程
          setTimeout(() => {
            console.log(`尝试重启账号 ${account.id} 的工作线程`);
            startWorkerForAccount(account);
          }, 5000);
        }
        delete workers[account.id];
      });

      workers[account.id] = worker;
      console.log(`账号 ${account.id} (${account.account}) 的工作线程已启动`);
    } catch (error) {
      console.error(`为账号 ${account.id} 启动工作线程失败:`, error.message);
    }
  }

  // 中间件
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // 获取所有账号状态的API
  app.get('/api/accounts-status', (req, res) => {
    // 创建账号ID映射，方便快速查找账号是否存在
    const accountIds = accounts.map(acc => acc.id);
    const validAccountIds = {};
    accountIds.forEach(id => {
      validAccountIds[id] = true;
    });
    
    // 过滤掉已删除账号的状态
    const filteredStatus = {};
    for (const id in accountsStatus) {
      // 只包含仍然存在于账号列表中的状态
      if (validAccountIds[id]) {
        filteredStatus[id] = accountsStatus[id];
      } else {
        // 如果发现状态中存在已删除的账号，清理它
        delete accountsStatus[id];
        console.log(`清理了已删除账号 ${id} 的残留状态`);
      }
    }
    
    res.json(filteredStatus);
  });

  // 获取特定账号状态的API
  app.get('/api/account-status/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (accountsStatus[id]) {
      res.json(accountsStatus[id]);
    } else {
      res.status(404).json({
        success: false,
        message: '未找到该账号的状态'
      });
    }
  });

  // 获取账号列表API
  app.get('/api/accounts', (req, res) => {
    res.json(accounts);
  });

  // 添加账号API
  app.post('/api/accounts', (req, res) => {
    try {
      const { account, pwd } = req.body;
      
      if (!account || !pwd) {
        return res.status(400).json({
          success: false,
          message: '账号和密码不能为空'
        });
      }
      
      // 检查账号是否已存在
      const existingAccount = accounts.find(acc => acc.account === account);
      if (existingAccount) {
        return res.status(400).json({
          success: false,
          message: '该账号已存在'
        });
      }
      
      // 生成新的ID
      const maxId = accounts.length > 0 ? Math.max(...accounts.map(acc => acc.id)) : 0;
      
      // 添加新账号
      const newAccount = {
        id: maxId + 1,
        account,
        pwd,
        enabled: true,
        lastUsed: null
      };
      
      accounts.push(newAccount);
      saveAccounts();

      // 为新账号启动工作线程
      if (newAccount.enabled) {
        startWorkerForAccount(newAccount);
      }
      
      res.json({
        success: true,
        message: '账号添加成功',
        account: newAccount
      });
    } catch (error) {
      console.error('添加账号失败:', error.message);
      res.status(500).json({
        success: false,
        message: '添加账号失败: ' + error.message
      });
    }
  });

  // 删除账号API
  app.delete('/api/accounts/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const index = accounts.findIndex(acc => acc.id === id);
      
      if (index === -1) {
        return res.status(404).json({
          success: false,
          message: '账号不存在'
        });
      }

      // 终止该账号的工作线程
      if (workers[id]) {
        try {
          workers[id].terminate();
          console.log(`已终止账号 ${id} 的工作线程`);
        } catch (e) {
          console.error(`终止账号 ${id} 的工作线程失败:`, e.message);
        }
        delete workers[id];
      }

      // 删除该账号的状态
      if (accountsStatus[id]) {
        delete accountsStatus[id];
        console.log(`已删除账号 ${id} 的状态信息`);
      }
      
      // 立即执行一次全局清理，确保所有引用都被移除
      for (const key in global) {
        if (global[key] && typeof global[key] === 'object' && global[key][id]) {
          try {
            delete global[key][id];
            console.log(`已清理全局对象 ${key} 中账号 ${id} 的引用`);
          } catch (e) {
            // 忽略无法删除的属性
          }
        }
      }
      
      // 从账号列表中删除
      const removedAccount = accounts.splice(index, 1)[0];
      console.log(`已从账号列表中删除账号: ${removedAccount.account} (ID: ${id})`);
      
      // 保存更新后的账号列表
      saveAccounts();
      
      res.json({
        success: true,
        message: '账号删除成功'
      });
    } catch (error) {
      console.error('删除账号失败:', error.message);
      res.status(500).json({
        success: false,
        message: '删除账号失败: ' + error.message
      });
    }
  });

  // 更新账号状态API
  app.put('/api/accounts/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { enabled, pwd } = req.body;
      
      const accountIndex = accounts.findIndex(acc => acc.id === id);
      
      if (accountIndex === -1) {
        return res.status(404).json({
          success: false,
          message: '账号不存在'
        });
      }

      const account = accounts[accountIndex];
      
      // 更新账号状态
      if (enabled !== undefined) {
        account.enabled = enabled;
        
        // 如果启用账号，则启动线程
        if (enabled && !workers[id]) {
          startWorkerForAccount(account);
        }
        // 如果禁用账号，则终止线程
        else if (!enabled && workers[id]) {
          workers[id].terminate();
          delete workers[id];
          delete accountsStatus[id];
        }
      }
      
      // 更新密码
      if (pwd !== undefined) {
        account.pwd = pwd;
        
        // 如果账号已启用且正在运行，重启线程以使用新密码
        if (account.enabled && workers[id]) {
          workers[id].terminate();
          delete workers[id];
          startWorkerForAccount(account);
        }
      }
      
      saveAccounts();
      
      res.json({
        success: true,
        message: '账号更新成功',
        account
      });
    } catch (error) {
      console.error('更新账号失败:', error.message);
      res.status(500).json({
        success: false,
        message: '更新账号失败: ' + error.message
      });
    }
  });

  // 手动触发特定账号登录的API
  app.post('/api/login/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const workerInst = workers[id];
      
      if (!workerInst) {
        return res.status(404).json({
          success: false,
          message: '账号不存在或未启用'
        });
      }
      
      // 通知工作线程执行登录
      workerInst.postMessage({ type: 'login' });
      
      res.json({
        success: true,
        message: '已触发登录请求'
      });
    } catch (error) {
      console.error('手动触发登录失败:', error.message);
      res.status(500).json({
        success: false,
        message: '手动触发登录失败: ' + error.message
      });
    }
  });

  // 汇总所有账号的售罄检查结果
  app.get('/api/all-soldout', (req, res) => {
    const allSoldOut = [];

    for (const id in accountsStatus) {
      const status = accountsStatus[id];
      if (status.soldOutStatus && status.soldOutStatus.goodsId) {
        allSoldOut.push({
          accountId: id,
          account: status.loginStatus.account,
          ...status.soldOutStatus
        });
      }
    }

    res.json({
      success: true,
      total: allSoldOut.length,
      data: allSoldOut
    });
  });

  // 手动推送销售数据API
  app.post('/api/push-sales', async (req, res) => {
    try {
      await pushSalesData();
      res.json({
        success: true,
        message: '销售数据推送成功'
      });
    } catch (error) {
      console.error('手动推送销售数据失败:', error.message);
      res.status(500).json({
        success: false,
        message: '推送失败: ' + error.message
      });
    }
  });

  // 测试推送时间逻辑API
  app.get('/api/push-time-check', (req, res) => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const shouldPush = shouldPushNow();

    res.json({
      success: true,
      data: {
        currentTime: now.toLocaleString('zh-CN'),
        hour: hour,
        minute: minute,
        shouldPush: shouldPush,
        isQuietHours: hour >= 0 && hour < 9,
        isCorrectMinute: minute === 59,
        nextPushTime: getNextPushTime()
      }
    });
  });

  // 获取下次推送时间
  function getNextPushTime() {
    const now = new Date();
    const nextPush = new Date(now);

    // 如果当前是静默时间（0-8点），下次推送是9:59
    if (now.getHours() >= 0 && now.getHours() < 9) {
      nextPush.setHours(9, 59, 0, 0);
      if (nextPush <= now) {
        nextPush.setDate(nextPush.getDate() + 1);
      }
    } else {
      // 否则是下一个小时的59分
      if (now.getMinutes() >= 59) {
        nextPush.setHours(nextPush.getHours() + 1);
      }
      nextPush.setMinutes(59, 0, 0);
    }

    return nextPush.toLocaleString('zh-CN');
  }

  // 系统性能监控API
  app.get('/api/system-status', (req, res) => {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    res.json({
      success: true,
      data: {
        memory: {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
          external: Math.round(memUsage.external / 1024 / 1024) + 'MB',
          rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB'
        },
        uptime: Math.round(uptime) + '秒',
        activeWorkers: Object.keys(workers).length,
        totalAccounts: accounts.length,
        enabledAccounts: accounts.filter(acc => acc.enabled).length,
        intervals: {
          login: LOGIN_INTERVAL / 1000 + '秒',
          soldOutCheck: SOLD_OUT_CHECK_INTERVAL / 1000 + '秒',
          salesCheck: SALES_CHECK_INTERVAL / 1000 + '秒'
        },
        pushSettings: {
          schedule: '每小时59分推送',
          quietHours: '凌晨12点-早上9点不推送',
          checkInterval: PUSH_CHECK_INTERVAL / 1000 + '秒'
        }
      }
    });
  });

  // 定期清理已删除账号的状态和内存优化
  function cleanupDeletedAccountsStatus() {
    // 创建账号ID映射
    const accountIds = accounts.map(acc => acc.id);
    const validAccountIds = {};
    accountIds.forEach(id => {
      validAccountIds[id] = true;
    });

    // 检查并清理已删除账号的状态
    let cleanupCount = 0;
    for (const id in accountsStatus) {
      if (!validAccountIds[id]) {
        delete accountsStatus[id];
        cleanupCount++;
      }
    }

    if (cleanupCount > 0) {
      console.log(`定期清理：移除了 ${cleanupCount} 个已删除账号的状态数据`);
    }

    // 内存使用情况监控
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed > 100 * 1024 * 1024) { // 超过100MB时警告
      console.log(`内存使用警告: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
      // 强制垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
        console.log('执行垃圾回收');
      }
    }
  }

  // 检查是否应该推送（每小时59分，且不在凌晨12点-早上9点）
  function shouldPushNow() {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // 凌晨12点到早上9点不推送
    if (hour >= 0 && hour < 9) {
      return false;
    }

    // 每小时的59分推送
    return minute === 59;
  }

  // 推送销售数据到pushplus
  async function pushSalesData() {
    try {
      console.log('开始推送今日销售数据...');

      // 收集所有账号的销售数据
      const salesData = [];
      let totalOrders = 0;
      let totalAmount = 0;

      for (const id in accountsStatus) {
        const status = accountsStatus[id];
        if (status.salesStatus && status.salesStatus.success) {
          const accountInfo = accounts.find(acc => acc.id == id);
          salesData.push({
            account: status.loginStatus.account,
            realName: status.loginStatus.real_name || '未知',
            todayOrders: status.salesStatus.todayOrders,
            todayAmount: status.salesStatus.todayAmount,
            updateTime: status.salesStatus.timestamp
          });
          totalOrders += status.salesStatus.todayOrders;
          totalAmount += status.salesStatus.todayAmount;
        }
      }

      if (salesData.length === 0) {
        console.log('没有可推送的销售数据');
        return;
      }

      // 生成HTML格式的推送内容
      const currentTime = new Date().toLocaleString('zh-CN');
      let htmlContent = `
        <h2>📊 今日销售数据汇总</h2>
        <p><strong>统计时间：</strong>${currentTime}</p>
        <div style="background-color: #f0f8ff; padding: 10px; border-radius: 5px; margin: 10px 0;">
          <h3>📈 总计</h3>
          <p><strong>总订单数：</strong><span style="color: #ff6b35; font-size: 18px;">${totalOrders}</span> 笔</p>
          <p><strong>总销售额：</strong><span style="color: #ff6b35; font-size: 18px;">¥${totalAmount.toFixed(2)}</span></p>
        </div>
        <h3>📋 各账号详情</h3>
      `;

      salesData.forEach((data, index) => {
        htmlContent += `
          <div style="border: 1px solid #ddd; padding: 10px; margin: 5px 0; border-radius: 5px;">
            <h4>${index + 1}. ${data.realName} (${data.account})</h4>
            <p><strong>订单数：</strong><span style="color: #4caf50;">${data.todayOrders}</span> 笔</p>
            <p><strong>销售额：</strong><span style="color: #4caf50;">¥${data.todayAmount}</span></p>
            <p><strong>更新时间：</strong>${new Date(data.updateTime).toLocaleString('zh-CN')}</p>
          </div>
        `;
      });

      htmlContent += `
        <hr>
        <p style="color: #666; font-size: 12px;">
          本消息由多账号监控系统自动发送<br>
          系统运行正常，共监控 ${salesData.length} 个账号
        </p>
      `;

      // 发送推送请求
      const response = await axios({
        method: 'get',
        url: 'https://www.pushplus.plus/send',
        params: {
          token: PUSH_CONFIG.token,
          title: `📊 今日销售数据 - 总计${totalOrders}笔/¥${totalAmount.toFixed(2)}`,
          content: htmlContent,
          template: PUSH_CONFIG.template,
          topic: PUSH_CONFIG.topic
        }
      });

      if (response.data && response.data.code === 200) {
        console.log('销售数据推送成功！');
      } else {
        console.error('销售数据推送失败:', response.data);
      }

    } catch (error) {
      console.error('推送销售数据时出错:', error.message);
    }
  }

  // 定时检查推送函数
  function checkAndPushSalesData() {
    if (shouldPushNow()) {
      const now = new Date();
      console.log(`推送时间到达: ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`);
      pushSalesData();
    }
  }

  // 进程优化配置
  process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
    // 不退出进程，继续运行
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
    // 不退出进程，继续运行
  });

  // 启动服务器
  app.listen(PORT, () => {
    // 加载账号配置
    loadAccounts();

    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`每15分钟自动执行一次登录请求（优化后）`);
    console.log(`每10秒自动检查一次售罄商品（优化后）`);
    console.log(`每30秒自动查询一次销售数据（优化后）`);
    console.log(`当前已加载${accounts.length}个账号`);
    
    // 系统启动，为所有启用的账号启动工作线程
    console.log(`系统启动，为所有启用的账号创建工作线程...`);
    startWorkersForAccounts();
    
    // 设置定期清理已删除账号的状态（每5分钟执行一次，减少频率）
    setInterval(cleanupDeletedAccountsStatus, 5 * 60 * 1000);
    console.log("已启用自动清理已删除账号的状态功能（每5分钟执行）");

    // 设置定期检查推送销售数据（每分钟检查一次，在每小时59分推送）
    setInterval(checkAndPushSalesData, PUSH_CHECK_INTERVAL);
    console.log("已启用自动推送销售数据功能（每小时59分推送，凌晨12点-早上9点不推送）");

    // 启动后延迟1分钟开始检查推送时间
    setTimeout(() => {
      console.log("开始检查推送时间...");
      checkAndPushSalesData();
    }, 60 * 1000);
  });
} 
// 工作线程代码
else {
  const axios = require('axios');
  const account = workerData.account;
  const LOGIN_INTERVAL = workerData.loginInterval;
  const SOLD_OUT_CHECK_INTERVAL = workerData.soldOutCheckInterval;
  const SALES_CHECK_INTERVAL = workerData.salesCheckInterval;
  const REQUEST_TIMEOUT = workerData.requestTimeout;

  // 创建axios实例，配置超时和连接池
  const axiosInstance = axios.create({
    timeout: REQUEST_TIMEOUT,
    maxRedirects: 3,
    headers: {
      'Connection': 'keep-alive',
      'Keep-Alive': 'timeout=5, max=1000'
    }
  });

  // 存储线程内的登录结果
  let loginResult = {
    timestamp: null,
    success: false,
    msg: '等待登录',
    real_name: '',
    token: '',
    account: account.account
  };

  // 存储线程内的售罄检查结果
  let soldOutResult = {
    timestamp: null,
    success: false,
    goodsId: '',
    onShelfStatus: '',
    onShelfMessage: ''
  };

  // 存储线程内的销售数据结果
  let salesResult = {
    timestamp: null,
    success: false,
    todayOrders: 0,
    todayAmount: 0
  };

  // 线程内的倒计时
  let loginCountdown = LOGIN_INTERVAL / 1000;
  let soldOutCountdown = SOLD_OUT_CHECK_INTERVAL / 1000;
  let salesCountdown = SALES_CHECK_INTERVAL / 1000;

  // 向主线程发送日志
  function log(message) {
    parentPort.postMessage({ type: 'log', data: message });
  }

  // 执行登录请求
  async function performLogin() {
    try {
      log(`执行登录请求，账号: ${account.account}...`);
      
      const response = await axiosInstance({
        method: 'post',
        url: 'https://ed.weeeg.com/adminapi/yudian',
        headers: {
          'Host': 'ed.weeeg.com',
          'Connection': 'keep-alive',
          'Content-Type': 'application/json;charset=UTF-8',
          'sec-ch-ua': '"Not)A;Brand";v="24", "Chromium";v="116"',
          'Accept': 'application/json, text/plain, */*',
          'sec-ch-ua-mobile': '?0',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36 Core/1.116.520.400 QQBrowser/19.2.6473.400',
          'sec-ch-ua-platform': '"Windows"',
          'Origin': 'https://ed.weeeg.com',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
          'Referer': 'https://ed.weeeg.com/yudian/h5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Cookie': 'cb_lang=zh-cn; PHPSESSID=6643c1d028eac2a9487e6274ca72c983; WS_ADMIN_URL=ws://ed.weeeg.com/notice; WS_CHAT_URL=ws://ed.weeeg.com/msg; pgv_info='
        },
        data: {
          "account": account.account,
          "pwd": account.pwd,
          "key": "68510365b2221",
          "captchaType": "blockPuzzle",
          "captchaVerification": "",
          "smscode": "",
          "smstoken": "",
          "xyphone": "",
          "xypwd": "",
          "status": 0,
          "pcstatus": 0
        }
      });

      // 检查是否存在 user_info
      if (response.data) {
        // 检查 real_name 的位置
        let realName = '未知';
        let token = '';
        
        // 获取token
        if (response.data && response.data.data && response.data.data.token) {
          token = response.data.data.token;
        }
        
        if (response.data.real_name) {
          realName = response.data.real_name;
        } else if (response.data.data && response.data.data.real_name) {
          realName = response.data.data.real_name;
        } else if (response.data.user_info && response.data.user_info.real_name) {
          realName = response.data.user_info.real_name;
        } else if (response.data.data && response.data.data.user_info && response.data.data.user_info.real_name) {
          realName = response.data.data.user_info.real_name;
        }

        // 更新登录结果
        loginResult = {
          timestamp: new Date(),
          success: response.data && response.data.msg === "success",
          msg: response.data ? response.data.msg : '无响应消息',
          real_name: realName,
          token: token,
          account: account.account
        };

        // 向主线程发送登录结果
        parentPort.postMessage({ type: 'login_result', data: loginResult });
        
        // 登录成功后立即检查售罄ID，销售数据按独立间隔查询
        if (loginResult.success && loginResult.token) {
          log(`登录成功! 用户: ${loginResult.real_name}, 账号: ${loginResult.account}`);
          // 重置登录倒计时
          loginCountdown = LOGIN_INTERVAL / 1000;
          // 立即检查售罄商品
          checkSoldOutItems();
          // 重置销售数据倒计时（不立即查询，减少登录时的并发请求）
          salesCountdown = SALES_CHECK_INTERVAL / 1000;
        } else {
          log(`账号 ${loginResult.account} 登录失败: ${loginResult.msg}`);
        }
      } else {
        loginResult = {
          timestamp: new Date(),
          success: false,
          msg: '无响应数据',
          real_name: '未知',
          token: '',
          account: account.account
        };
        parentPort.postMessage({ type: 'login_result', data: loginResult });
      }
      
      return loginResult;
    } catch (error) {
      log(`登录请求出错: ${error.message}`);
      
      loginResult = {
        timestamp: new Date(),
        success: false,
        msg: error.message,
        real_name: '',
        token: '',
        account: account.account
      };
      
      parentPort.postMessage({ type: 'login_result', data: loginResult });
      return loginResult;
    }
  }

  // 检查售罄商品
  async function checkSoldOutItems() {
    try {
      const token = loginResult.token;
      
      if (!token) {
        log(`无法检查售罄商品: 账号 ${account.account} 缺少token`);
        return null;
      }
      
      log(`正在检查账号 ${account.account} 的售罄商品...`);
      
      // 获取当前时间戳（秒）
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      // 从token中提取uuid（用户ID）
      let uuid = '19209'; // 默认值
      try {
        // 尝试从token中解析用户信息
        const tokenData = token.split('.')[1];
        if (tokenData) {
          const decoded = JSON.parse(Buffer.from(tokenData, 'base64').toString());
          if (decoded && decoded.jti && decoded.jti.id) {
            uuid = decoded.jti.id.toString();
          }
        }
      } catch (e) {
        log(`解析token获取uuid失败: ${e.message}`);
      }
      
      const response = await axiosInstance({
        method: 'get',
        url: 'https://ed.weeeg.com/adminapi/product/product',
        params: {
          page: 1,
          limit: 15,
          cate_id: '',
          type: 4,
          store_name: '',
          name: ''
        },
        headers: {
          'Host': 'ed.weeeg.com',
          'Connection': 'keep-alive',
          'sec-ch-ua': '"Not)A;Brand";v="24", "Chromium";v="116"',
          'Accept': 'application/json, text/plain, */*',
          'Authori-zation': `Bearer ${token}`,
          'sec-ch-ua-mobile': '?0',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36 Core/1.116.520.400 QQBrowser/19.2.6473.400',
          'sec-ch-ua-platform': '"Windows"',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
          'Referer': 'https://ed.weeeg.com/ekadmin/product/product_list',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Cookie': `cb_lang=zh-cn; PHPSESSID=6643c1d028eac2a9487e6274ca72c983; WS_ADMIN_URL=ws://ed.weeeg.com/notice; WS_CHAT_URL=ws://ed.weeeg.com/msg; uuid=${uuid}; token=${token}; expires_time=${currentTimestamp}; pgv_info==undefined`
        }
      });
      
      let goodsId = '';
      let success = false;
      
      if (response.data && response.data.data && response.data.data.list && response.data.data.list.length > 0) {
        goodsId = response.data.data.list[0].goods_id || '';
        success = true;
        log(`账号 ${account.account} 获取到售罄ID: ${goodsId}`);
        
        // 找到售罄商品，自动提交上架请求
        if (goodsId) {
          await sendProductOnShelf(goodsId);
        }
      } else {
        log(`账号 ${account.account} 未找到售罄商品`);
      }
      
      // 更新售罄结果
      soldOutResult = {
        timestamp: new Date(),
        success,
        goodsId,
        onShelfStatus: '',
        onShelfMessage: ''
      };
      
      // 向主线程发送售罄结果
      parentPort.postMessage({ type: 'soldout_result', data: soldOutResult });
      
      return soldOutResult;
    } catch (error) {
      log(`账号 ${account.account} 检查售罄商品出错: ${error.message}`);
      
      soldOutResult = {
        timestamp: new Date(),
        success: false,
        goodsId: '',
        onShelfStatus: '',
        onShelfMessage: '',
      };
      
      parentPort.postMessage({ type: 'soldout_result', data: soldOutResult });
      
      return soldOutResult;
    }
  }

  // 查询销售数据
  async function checkSalesData() {
    try {
      const token = loginResult.token;

      if (!token) {
        log(`无法查询销售数据: 账号 ${account.account} 缺少token`);
        return null;
      }

      log(`正在查询账号 ${account.account} 的销售数据...`);

      // 获取当前时间戳（秒）
      const currentTimestamp = Math.floor(Date.now() / 1000);

      // 从token中提取uuid（用户ID）
      let uuid = '19209'; // 默认值
      try {
        // 尝试从token中解析用户信息
        const tokenData = token.split('.')[1];
        if (tokenData) {
          const decoded = JSON.parse(Buffer.from(tokenData, 'base64').toString());
          if (decoded && decoded.jti && decoded.jti.id) {
            uuid = decoded.jti.id.toString();
          }
        }
      } catch (e) {
        log(`解析token获取uuid失败: ${e.message}`);
      }

      const response = await axiosInstance({
        method: 'get',
        url: 'https://ed.weeeg.com/adminapi/home/header',
        headers: {
          'Host': 'ed.weeeg.com',
          'Connection': 'keep-alive',
          'sec-ch-ua': '"Not)A;Brand";v="24", "Chromium";v="116"',
          'Accept': 'application/json, text/plain, */*',
          'Authori-zation': `Bearer ${token}`,
          'sec-ch-ua-mobile': '?0',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36 Core/1.116.520.400 QQBrowser/19.2.6473.400',
          'sec-ch-ua-platform': '"Windows"',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
          'Referer': 'https://ed.weeeg.com/ekadmin/index',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Cookie': `uuid=${uuid}; cb_lang=zh-cn; PHPSESSID=6df93918db8efcfbd7927c4d6676883b; pgv_info=; WS_ADMIN_URL=ws://ed.weeeg.com/notice; WS_CHAT_URL=ws://ed.weeeg.com/msg; token=${token}; expires_time=${currentTimestamp}`
        }
      });

      let todayOrders = 0;
      let todayAmount = 0;
      let success = false;

      if (response.data && response.data.data && response.data.data.info && response.data.data.info.info && response.data.data.info.info.length >= 2) {
        // 取出data.info.info[0].today的值为今日销售订单数
        if (response.data.data.info.info[0] && response.data.data.info.info[0].today !== undefined) {
          todayOrders = parseInt(response.data.data.info.info[0].today) || 0;
        }

        // 取出data.info.info[1].today的值为今日销售金额
        if (response.data.data.info.info[1] && response.data.data.info.info[1].today !== undefined) {
          todayAmount = parseFloat(response.data.data.info.info[1].today) || 0;
        }

        success = true;
        log(`账号 ${account.account} 今日订单数: ${todayOrders}, 今日销售额: ${todayAmount}`);
      } else {
        log(`账号 ${account.account} 销售数据格式异常`);
      }

      // 更新销售结果
      salesResult = {
        timestamp: new Date(),
        success,
        todayOrders,
        todayAmount
      };

      // 向主线程发送销售结果
      parentPort.postMessage({ type: 'sales_result', data: salesResult });

      return salesResult;
    } catch (error) {
      log(`账号 ${account.account} 查询销售数据出错: ${error.message}`);

      salesResult = {
        timestamp: new Date(),
        success: false,
        todayOrders: 0,
        todayAmount: 0
      };

      parentPort.postMessage({ type: 'sales_result', data: salesResult });

      return salesResult;
    }
  }

  // 上架售罄商品的函数
  async function sendProductOnShelf(goodsId) {
    try {
      const token = loginResult.token;
      
      if (!token) {
        log(`账号 ${account.account} 无法上架商品: 缺少token`);
        return null;
      }
      
      log(`账号 ${account.account} 正在上架商品ID: ${goodsId}...`);
      
      // 获取当前时间戳（秒）
      const currentTimestamp = Math.floor(Date.now() / 1000);
      
      // 从token中提取uuid（用户ID）
      let uuid = '19209'; // 默认值
      try {
        // 尝试从token中解析用户信息
        const tokenData = token.split('.')[1];
        if (tokenData) {
          const decoded = JSON.parse(Buffer.from(tokenData, 'base64').toString());
          if (decoded && decoded.jti && decoded.jti.id) {
            uuid = decoded.jti.id.toString();
          }
        }
      } catch (e) {
        log(`解析token获取uuid失败: ${e.message}`);
      }
      
      const response = await axiosInstance({
        method: 'post',
        url: 'https://ed.weeeg.com/adminapi/product/batchsend',
        headers: {
          'Host': 'ed.weeeg.com',
          'Connection': 'keep-alive',
          'Content-Type': 'application/json;charset=UTF-8',
          'sec-ch-ua': '"Not)A;Brand";v="24", "Chromium";v="116"',
          'Accept': 'application/json, text/plain, */*',
          'Authori-zation': `Bearer ${token}`,
          'sec-ch-ua-mobile': '?0',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36 Core/1.116.520.400 QQBrowser/19.2.6473.400',
          'sec-ch-ua-platform': '"Windows"',
          'Origin': 'https://ed.weeeg.com',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
          'Referer': 'https://ed.weeeg.com/ekadmin/product/product_list',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Cookie': `cb_lang=zh-cn; PHPSESSID=6643c1d028eac2a9487e6274ca72c983; WS_ADMIN_URL=ws://ed.weeeg.com/notice; WS_CHAT_URL=ws://ed.weeeg.com/msg; uuid=${uuid}; token=${token}; expires_time=${currentTimestamp}; pgv_info==undefined`
        },
        data: {
          "goodsId": "",
          "uid": "",
          "ids": [goodsId],
          "batch_key": 1
        }
      });
      
      let onShelfStatus = '失败';
      let onShelfMessage = '';
      
      if (response.data && response.data.msg) {
        onShelfMessage = response.data.msg;
      }
      
      // 根据返回的status判断成功或失败
      if (response.data && (response.data.status === 200 || response.data.code === 200 || response.data.msg === "执行成功")) {
        onShelfStatus = '成功';
        log(`账号 ${account.account} 商品 ${goodsId} 上架成功!`);
      } else {
        log(`账号 ${account.account} 商品 ${goodsId} 上架失败`);
      }
      
      // 更新售罄结果中的上架信息
      soldOutResult.onShelfStatus = onShelfStatus;
      soldOutResult.onShelfMessage = onShelfMessage;
      
      // 向主线程发送更新后的售罄结果
      parentPort.postMessage({ type: 'soldout_result', data: soldOutResult });
      
      return response.data;
    } catch (error) {
      log(`账号 ${account.account} 上架商品失败: ${error.message}`);
      
      // 更新售罄结果中的上架信息
      soldOutResult.onShelfStatus = '失败';
      soldOutResult.onShelfMessage = error.message;
      
      // 向主线程发送更新后的售罄结果
      parentPort.postMessage({ type: 'soldout_result', data: soldOutResult });
      
      return null;
    }
  }

  // 启动工作线程后立即执行一次登录
  performLogin();

  // 设置间隔，每秒更新倒计时并发送给主线程
  setInterval(() => {
    loginCountdown--;
    soldOutCountdown--;
    salesCountdown--;

    // 发送倒计时状态给主线程
    parentPort.postMessage({
      type: 'countdown',
      data: { loginCountdown, soldOutCountdown }
    });

    // 登录倒计时结束
    if (loginCountdown <= 0) {
      log(`账号 ${account.account} 登录倒计时结束，执行登录请求...`);
      performLogin();
      loginCountdown = LOGIN_INTERVAL / 1000;
    }

    // 售罄检查倒计时结束
    if (soldOutCountdown <= 0) {
      if (loginResult.token) {
        log(`账号 ${account.account} 售罄检查倒计时结束，执行检查...`);
        checkSoldOutItems();
      } else {
        log(`账号 ${account.account} 未登录或缺少token，跳过检查售罄商品`);
      }
      soldOutCountdown = SOLD_OUT_CHECK_INTERVAL / 1000;
    }

    // 销售数据查询倒计时结束（独立频率）
    if (salesCountdown <= 0) {
      if (loginResult.token) {
        checkSalesData();
      }
      salesCountdown = SALES_CHECK_INTERVAL / 1000;
    }
  }, 1000);

  // 监听来自主线程的消息
  parentPort.on('message', async (message) => {
    if (message.type === 'login') {
      await performLogin();
    } else if (message.type === 'checkSoldOut') {
      await checkSoldOutItems();
    }
  });
} 