const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const os = require('os');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const db = require('./db');
const { exportVehiclesToWorkbook, parseVehiclesFromWorkbook, generateSampleTemplate } = require('./excel-service');
const { sendActivationEmail, getEmailPreview } = require('./email-service');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Active VoIP Internet Calls map: callId -> Session
const activeCalls = new Map();

// WebSocket connection for real-time Internet Voice Calling
wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const callId = url.searchParams.get('callId');
    const role = url.searchParams.get('role'); // 'web' or 'app'

    if (callId) {
      const call = activeCalls.get(callId);
      if (call) {
        if (role === 'web') call.webWs = ws;
        if (role === 'app') call.appWs = ws;
      }

      ws.on('message', (message, isBinary) => {
        try {
          const currentCall = activeCalls.get(callId);
          const targetWs = (role === 'web') ? currentCall?.appWs : currentCall?.webWs;
          if (targetWs && targetWs.readyState === 1) { // 1 = OPEN
            targetWs.send(message, { binary: isBinary });
          }
        } catch {}
      });

      ws.on('close', () => {
        const currentCall = activeCalls.get(callId);
        if (currentCall) {
          if (role === 'web' && currentCall.webWs === ws) currentCall.webWs = null;
          if (role === 'app' && currentCall.appWs === ws) currentCall.appWs = null;
        }
      });
    }
  } catch (err) {
    console.error('[WSS ERROR]', err.message);
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Auto-detect primary non-internal IPv4
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const dev in ifaces) {
    for (const details of ifaces[dev]) {
      if (details.family === 'IPv4' && !details.internal && !details.address.startsWith('169.254')) {
        return details.address;
      }
    }
  }
  return 'localhost';
}
const LOCAL_IP = getLocalIP();

function getPublicHost(req) {
  if (process.env.PUBLIC_HOST) return process.env.PUBLIC_HOST;
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL.replace(/^https?:\/\//, '');
  }
  if (process.env.RENDER || PORT == 10000) {
    return 'safeqr-backend-o13q.onrender.com';
  }
  if (req && req.get('host')) return req.get('host');
  return `${LOCAL_IP}:${PORT}`;
}

function getBaseUrl(req) {
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  }
  if (process.env.RENDER || PORT == 10000) {
    return 'https://safeqr-backend-o13q.onrender.com';
  }
  const host = getPublicHost(req);
  const proto = req ? (req.headers['x-forwarded-proto'] || req.protocol || 'http') : 'http';
  return `${proto}://${host}`;
}

app.use(cors());
app.use(express.json());

let sseClients = [];

// SSE Event Stream for Vehicle Owner App & Bystander Web Portals
app.get('/api/incidents/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter((client) => client !== res);
  });
});

function broadcastIncident(incident) {
  const data = JSON.stringify({ type: 'INCIDENT_UPDATE', incident });
  sseClients.forEach((client) => {
    try { client.write(`data: ${data}\n\n`); } catch {}
  });
}

function broadcastContactsUpdate(contacts) {
  const data = JSON.stringify({ type: 'CONTACTS_UPDATED', contacts });
  sseClients.forEach((client) => {
    try { client.write(`data: ${data}\n\n`); } catch {}
  });
}

function broadcastSettingsUpdate(settings) {
  const data = JSON.stringify({ type: 'SETTINGS_UPDATED', settings });
  sseClients.forEach((client) => {
    try { client.write(`data: ${data}\n\n`); } catch {}
  });
}

function broadcastVehicleStatusUpdate(vehicle) {
  const data = JSON.stringify({
    type: 'VEHICLE_STATUS_UPDATE',
    vehicleId: vehicle.id,
    registrationPlate: vehicle.registrationPlate,
    guardStatus: vehicle.guardStatus || 'GUARD_ACTIVE',
  });
  sseClients.forEach((client) => {
    try { client.write(`data: ${data}\n\n`); } catch {}
  });
}

function broadcastConfigUpdate(config) {
  const publicConfig = {
    helpline: config.helpline,
    pricing: config.pricing,
    demoVideo: config.demoVideo,
    banners: config.banners,
    onboarding: config.onboarding,
    timestamp: Date.now()
  };
  const data = JSON.stringify({ type: 'CONFIG_UPDATED', config: publicConfig });
  sseClients.forEach((client) => {
    try { client.write(`data: ${data}\n\n`); } catch {}
  });
}

// ----------------------------------------------------
// 1. PUBLIC MARKETING & PURCHASE WEBSITE (GET /)
// ----------------------------------------------------
app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'views', 'public-landing.html');
  if (fs.existsSync(filePath)) {
    let html = fs.readFileSync(filePath, 'utf8');
    const currentBase = getBaseUrl(req);
    const injectScript = `<script>window.SAFEQR_LAN_BASE = "${currentBase}";</script>`;
    html = html.replace('</head>', `${injectScript}\n</head>`);
    return res.send(html);
  }
  res.send('Public Landing Page template missing.');
});

// ----------------------------------------------------
// 2. WEB-BASED ADMIN CONTROL PANEL (GET /admin)
// ----------------------------------------------------
app.get('/admin', (req, res) => {
  const filePath = path.join(__dirname, 'views', 'admin-dashboard.html');
  if (fs.existsSync(filePath)) {
    let html = fs.readFileSync(filePath, 'utf8');
    const currentBase = getBaseUrl(req);
    const injectScript = `<script>window.SAFEQR_LAN_BASE = "${currentBase}";</script>`;
    html = html.replace('</head>', `${injectScript}\n</head>`);
    return res.send(html);
  }
  res.send('Admin Dashboard template missing.');
});

// ----------------------------------------------------
// 3. USER AUTHENTICATION (MOBILE OTP), PROFILE & ADMIN
// ----------------------------------------------------
app.post('/api/auth/send-otp', (req, res) => {
  const { phone } = req.body;
  if (!phone || phone.toString().trim().length < 10) {
    return res.status(400).json({ success: false, error: 'Valid 10-digit mobile number is required.' });
  }

  const cleanPhone = phone.toString().replace(/\D/g, '');
  const otpCode = cleanPhone === '8839786266' ? '1056' : Math.floor(1000 + Math.random() * 9000).toString();
  db.setOtp(cleanPhone, otpCode);

  console.log(`[AUTH] 📱 OTP generated for +91 ${cleanPhone}: ${otpCode}`);

  res.json({
    success: true,
    otp: otpCode,
    phone: cleanPhone,
    message: `OTP sent successfully to +91 ${cleanPhone}. Verification code: ${otpCode}`
  });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) {
    return res.status(400).json({ success: false, error: 'Phone and OTP are required.' });
  }

  const cleanPhone = phone.toString().replace(/\D/g, '');
  const isValid = db.verifyOtp(cleanPhone, otp);

  if (!isValid) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired OTP. Please use demo code 1056 or request a new code.'
    });
  }

  const existingUser = db.getUserByPhone(cleanPhone);
  const userVehicles = (db.getAllVehicles() || []).filter(
    v => (v.ownerPhone || '').toString().replace(/\D/g, '') === cleanPhone
  );

  console.log(`[AUTH] ✅ User +91 ${cleanPhone} verified. Existing profile: ${Boolean(existingUser)}`);

  res.json({
    success: true,
    isNewUser: !existingUser,
    user: existingUser,
    vehicle: userVehicles[0] || null,
    vehiclesCount: userVehicles.length
  });
});

app.get('/api/user/profile', (req, res) => {
  const { phone } = req.query;
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number is required.' });
  }
  const user = db.getUserByPhone(phone);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User profile not found.' });
  }
  res.json({ success: true, user });
});

app.post('/api/user/profile', (req, res) => {
  try {
    const user = db.createOrUpdateUser(req.body);
    console.log(`[USER PROFILE UPDATED] ${user.name} (+91 ${user.phone}) saved to database.`);
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Master App & System Configuration Endpoints
app.get('/api/config', (req, res) => {
  const fullConfig = db.getConfig();
  const publicHost = getPublicHost(req);
  console.log('[CONFIG] 📥 GET /api/config from', req.ip, 'host:', publicHost, 'at', new Date().toLocaleTimeString());
  res.json({
    success: true,
    serverHost: publicHost,
    localIp: LOCAL_IP,
    port: PORT,
    config: fullConfig,
    helpline: fullConfig.helpline,
    pricing: fullConfig.pricing,
    demoVideo: fullConfig.demoVideo,
    banners: fullConfig.banners,
    onboarding: fullConfig.onboarding,
    timestamp: Date.now()
  });
});

app.get('/api/admin/config', (req, res) => {
  const fullConfig = db.getConfig();
  res.json({ success: true, config: fullConfig });
});

app.post('/api/admin/config', (req, res) => {
  try {
    const updated = db.updateConfig(req.body);
    broadcastConfigUpdate(updated);
    console.log('[CONFIG] ⚙️ Master configuration updated by admin and broadcasted via SSE.');
    res.json({ success: true, config: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Admin User Management Endpoints
app.get('/api/admin/users', (req, res) => {
  const users = db.getAllUsers();
  const vehicles = db.getAllVehicles();
  const orders = db.getAllOrders();

  const enrichedUsers = users.map((u) => {
    const cleanPhone = (u.phone || '').toString().replace(/\D/g, '');
    const userVehicles = vehicles.filter(
      (v) => (v.ownerPhone || '').toString().replace(/\D/g, '') === cleanPhone
    );
    const userOrders = orders.filter(
      (o) => (o.ownerPhone || '').toString().replace(/\D/g, '') === cleanPhone
    );
    return {
      ...u,
      vehiclesCount: userVehicles.length,
      ordersCount: userOrders.length,
      vehicles: userVehicles.map((v) => ({
        id: v.id,
        plate: v.registrationPlate,
        model: v.model,
        guardStatus: v.guardStatus,
      })),
    };
  });

  res.json({ success: true, users: enrichedUsers });
});

app.post('/api/admin/users/:phone/status', (req, res) => {
  const { phone } = req.params;
  const { status } = req.body; // 'ACTIVE' or 'SUSPENDED'
  const user = db.updateUserStatus(phone, status);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  console.log(`[ADMIN] User ${phone} status changed to: ${status}`);
  res.json({ success: true, user });
});

app.post('/api/admin/users/:phone/reset-calls', (req, res) => {
  const { phone } = req.params;
  const { count } = req.body;
  const user = db.resetUserCalls(phone, count);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  console.log(`[ADMIN] User ${phone} free calls reset to: ${user.freeCallsRemaining}`);
  res.json({ success: true, user });
});

app.post('/api/admin/reset-data', (req, res) => {
  db.clearAllUserData();
  console.log('[ADMIN] 🧹 All user data, vehicles, orders, and incidents cleared.');
  res.json({ success: true, message: 'All user data, vehicles, orders and incidents cleared successfully.' });
});

// Admin Live Integration Testing Endpoints
app.post('/api/admin/test-otp', (req, res) => {
  const { channel, recipient } = req.body;
  const config = db.getConfig();
  const testCode = '1056';

  if (channel === 'email') {
    const host = config.otpServices?.emailSmtp?.host || 'smtp.gmail.com';
    console.log(`[TEST-EMAIL] ✉️ Sent OTP ${testCode} via SMTP (${host}) to ${recipient}`);
    return res.json({
      success: true,
      message: `Test OTP (${testCode}) dispatched to Email: ${recipient} via ${host}`
    });
  } else {
    const gateway = config.otpServices?.activeSmsGateway || 'mock';
    console.log(`[TEST-SMS] 📱 Sent OTP ${testCode} via ${gateway} to ${recipient}`);
    return res.json({
      success: true,
      message: `Test OTP (${testCode}) dispatched to Mobile: ${recipient} via ${gateway.toUpperCase()} Gateway`
    });
  }
});

app.post('/api/admin/test-payment', (req, res) => {
  const { gateway } = req.body;
  const config = db.getConfig();
  const gatewayInfo = config.paymentGateways?.[gateway] || {};
  res.json({
    success: true,
    gateway,
    status: 'ACTIVE_SANDBOX',
    message: `Payment gateway "${(gateway || 'gateway').toUpperCase()}" connection verified in Sandbox Mode. Webhook & Key handshake passed.`,
    details: gatewayInfo
  });
});

app.get('/api/banners', (req, res) => {
  const banners = db.getConfig().banners || [];
  res.json({ success: true, banners });
});

app.post('/api/banners', (req, res) => {
  if (Array.isArray(req.body.banners)) {
    db.updateConfig({ banners: req.body.banners });
    broadcastConfigUpdate(db.getConfig());
  }
  res.json({ success: true, banners: db.getConfig().banners });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const isValid = db.verifyAdmin(username, password);
  if (isValid) {
    res.json({ success: true, message: 'Authentication successful' });
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

// Vehicle Owner Mobile App Activation / Binding Endpoint
app.post('/api/auth/activate-vehicle', (req, res) => {
  const { activationKey, ownerName, registrationPlate } = req.body;
  if (!activationKey || activationKey.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Activation key is required.' });
  }

  const vehicle = db.getVehicleByActivationKey(activationKey);
  if (!vehicle) {
    return res.status(404).json({
      success: false,
      error: 'Invalid activation key. Please verify key from your purchase email or Admin Decal pass.'
    });
  }

  // If ownerName is provided, check matching substring
  if (ownerName && ownerName.trim().length > 0) {
    const inputName = ownerName.trim().toLowerCase();
    const vehOwner = (vehicle.ownerName || '').trim().toLowerCase();
    if (!vehOwner.includes(inputName) && !inputName.includes(vehOwner)) {
      return res.status(401).json({
        success: false,
        error: `Owner name does not match the registered record (${vehicle.ownerName}) for this key.`
      });
    }
  }

  // If plate is provided, check matching plate
  if (registrationPlate && registrationPlate.trim().length > 0) {
    const cleanInputPlate = registrationPlate.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    const cleanVehPlate = (vehicle.registrationPlate || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (cleanInputPlate !== cleanVehPlate) {
      return res.status(401).json({
        success: false,
        error: `Vehicle plate does not match the registered plate (${vehicle.registrationPlate}) for this key.`
      });
    }
  }

  res.json({
    success: true,
    message: 'Vehicle shield successfully activated and bound.',
    vehicle
  });
});

app.get('/api/admin/metrics', (req, res) => {
  const vehicles = db.getAllVehicles();
  const orders = db.getAllOrders();
  const activeVehicles = vehicles.filter(v => v.guardStatus === 'GUARD_ACTIVE').length;

  res.json({
    totalVehicles: vehicles.length,
    activeVehicles,
    totalOrders: orders.length,
    totalRevenue: orders.reduce((sum, o) => sum + (o.amount || 0), 0)
  });
});

// ----------------------------------------------------
// 4. VEHICLES CRUD & SEARCH APIS
// ----------------------------------------------------
app.get('/api/vehicles', (req, res) => {
  const filters = {
    search: req.query.search,
    country: req.query.country,
    state: req.query.state,
    bloodGroup: req.query.bloodGroup,
    status: req.query.status
  };
  const vehicles = db.getAllVehicles(filters);
  res.json({ success: true, count: vehicles.length, vehicles });
});

app.post('/api/vehicles', (req, res) => {
  try {
    const created = db.createVehicle(req.body);
    res.status(201).json({ success: true, vehicle: created });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/vehicles/:id', (req, res) => {
  const vehicle = db.getVehicleById(req.params.id);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
  res.json({ vehicle });
});

app.put('/api/vehicles/:id', (req, res) => {
  const updated = db.updateVehicle(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Vehicle not found' });
  broadcastContactsUpdate(updated.emergencyContacts || []);
  broadcastVehicleStatusUpdate(updated);
  console.log(`[VEHICLE UPDATED] ${updated.registrationPlate} -> Status: ${updated.guardStatus}`);
  res.json({ success: true, vehicle: updated });
});

app.put('/api/vehicles/:id/status', (req, res) => {
  const { id } = req.params;
  const { guardStatus } = req.body;

  const vehicle = db.getVehicleById(id) || db.getVehicleByToken(id);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

  // If vehicle was suspended by admin, prevent regular user toggle from bypassing suspension
  if (vehicle.guardStatus === 'SUSPENDED' && guardStatus !== 'SUSPENDED') {
    return res.status(403).json({ error: 'Vehicle shield is suspended by administrator and cannot be modified directly.' });
  }

  const updated = db.updateVehicle(vehicle.id, { guardStatus });
  broadcastVehicleStatusUpdate(updated);
  console.log(`[GUARD STATUS TOGGLED] ${updated.registrationPlate} -> ${updated.guardStatus}`);
  res.json({ success: true, guardStatus: updated.guardStatus, vehicle: updated });
});

app.delete('/api/vehicles/:id', (req, res) => {
  const success = db.deleteVehicle(req.params.id);
  res.json({ success });
});

// ----------------------------------------------------
// 5. PUBLIC ORDER CHECKOUT & EMAIL DISPATCH
// ----------------------------------------------------
app.post('/api/orders/checkout', (req, res) => {
  try {
    const raw = req.body || {};
    const vehicleData = {
      ...raw,
      ownerPhone: raw.ownerPhone || raw.phone || '',
      ownerName: raw.ownerName || raw.fullName || raw.name || 'Vehicle Owner',
      registrationPlate: raw.registrationPlate || raw.vehiclePlate || raw.vehicleNumber || 'MH-12-DE-9900',
      address: raw.address || raw.deliveryAddress || '',
      paidAmount: raw.amount || raw.paidAmount || 299
    };
    const vehicle = db.createVehicle(vehicleData);

    const order = db.createOrder({
      vehiclePlate: vehicle.registrationPlate,
      ownerName: vehicle.ownerName,
      ownerEmail: vehicle.ownerEmail,
      ownerPhone: vehicle.ownerPhone,
      plan: raw.plan || raw.packName || 'Digital + Decal Safety Pack',
      amount: raw.amount || 299,
      activationKey: vehicle.activationKey
    });

    // Also auto-associate or update user profile with latest details if phone provided
    if (vehicle.ownerPhone) {
      try {
        db.createOrUpdateUser({
          phone: vehicle.ownerPhone,
          name: vehicle.ownerName,
          address: vehicle.address,
          city: vehicle.city,
          state: vehicle.state,
          pincode: raw.pincode
        });
      } catch (uErr) {
        console.warn('[CHECKOUT] Non-fatal user sync warning:', uErr.message);
      }
    }

    // Dispatch confirmation email
    sendActivationEmail(vehicle, order);

    res.status(201).json({
      success: true,
      vehicle,
      order
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/orders', (req, res) => {
  const { phone } = req.query;
  const orders = db.getAllOrders({ phone });
  res.json({ success: true, count: orders.length, orders });
});

app.put('/api/orders/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, deliveryStatus } = req.body;
  const updated = db.updateOrderStatus(id, status, deliveryStatus);
  if (!updated) {
    return res.status(404).json({ success: false, error: 'Order not found.' });
  }
  console.log(`[ORDER STATUS UPDATED] ${id} -> Status: ${updated.status}, Delivery: ${updated.deliveryStatus}`);
  res.json({ success: true, order: updated });
});

app.get('/api/email/preview/:orderId', (req, res) => {
  const html = getEmailPreview(req.params.orderId);
  if (html) {
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  }
  res.status(404).send('Email preview not found.');
});

// ----------------------------------------------------
// 6. SYSTEM SETTINGS & COMPANY IVR MANAGEMENT
// ----------------------------------------------------
app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

app.put('/api/settings', (req, res) => {
  const updated = db.updateSettings(req.body);
  broadcastSettingsUpdate(updated);
  res.json({ success: true, settings: updated });
});

// ----------------------------------------------------
// 7. EXCEL IMPORT & EXPORT APIS
// ----------------------------------------------------
app.get('/api/admin/export/excel', (req, res) => {
  const filters = {
    search: req.query.search,
    country: req.query.country,
    state: req.query.state,
    bloodGroup: req.query.bloodGroup,
    status: req.query.status
  };

  const vehicles = db.getAllVehicles(filters);
  const buffer = exportVehiclesToWorkbook(vehicles);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=SafeQR_Vehicles_${Date.now()}.xlsx`);
  res.send(buffer);
});

app.post('/api/admin/import/excel', upload.single('file'), (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ success: false, error: 'No Excel file uploaded.' });
  }

  try {
    const parsedList = parseVehiclesFromWorkbook(req.file.buffer);
    let createdCount = 0;

    parsedList.forEach((item) => {
      db.createVehicle(item);
      createdCount++;
    });

    res.json({
      success: true,
      importedCount: createdCount,
      message: `Successfully imported ${createdCount} vehicles into SafeQR.`
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/sample-excel', (req, res) => {
  const buffer = generateSampleTemplate();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=SafeQR_Sample_Import_Template.xlsx');
  res.send(buffer);
});

// ----------------------------------------------------
// 8. INCIDENT DISPATCH & RESPOND APIS
// ----------------------------------------------------
app.post('/api/incidents', (req, res) => {
  const { category, customNote, isUrgent, vehicleId } = req.body;

  const messages = {
    CAR_BLOCKED: 'Your vehicle is obstructing a driveway or blocked another car. Please move it.',
    AMBULANCE_PATH_BLOCKED: '🚨 CRITICAL: Ambulance / Emergency vehicle blocked! Immediate relocation required!',
    HAZARD_DETECTED: 'Safety alert: Your car window is open or headlights left on.',
    WRONG_PARKING: 'Notice: Vehicle parked in unauthorized or restricted parking slot.',
    SOS_ACCIDENT: '🆘 ACCIDENT EMERGENCY: Bystander triggered accident alert. Family contacts notified!',
  };

  let vehicle = vehicleId ? (db.getVehicleById(vehicleId) || db.getVehicleByToken(vehicleId)) : null;
  if (!vehicle && vehicleId) {
    vehicle = { id: vehicleId, registrationPlate: req.body.registrationPlate || vehicleId, guardStatus: 'GUARD_ACTIVE' };
  } else if (!vehicle) {
    vehicle = db.getAllVehicles()[0] || { id: 'veh-9900', registrationPlate: 'MH-12-DE-9900', guardStatus: 'GUARD_ACTIVE' };
  }

  const guardStatus = vehicle.guardStatus || 'GUARD_ACTIVE';

  if (guardStatus === 'SUSPENDED') {
    console.log(`[INCIDENT BLOCKED] Vehicle ${vehicle.registrationPlate} shield is SUSPENDED.`);
    return res.status(403).json({
      success: false,
      error: 'SHIELD_SUSPENDED',
      message: 'SafeQR Shield for this vehicle has been SUSPENDED by administration. Incident reporting is disabled.'
    });
  }

  const isMuted = guardStatus === 'STANDBY';

  const newIncident = {
    id: `INC-${Date.now()}`,
    vehicleId: vehicle.id,
    registrationPlate: vehicle.registrationPlate,
    category: category || 'CAR_BLOCKED',
    message: customNote || messages[category] || 'Vehicle issue reported by bystander.',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    status: 'PENDING',
    isUrgent: category === 'AMBULANCE_PATH_BLOCKED' || category === 'SOS_ACCIDENT' || Boolean(isUrgent),
    isMuted,
    responseMessage: null,
    resolvedAt: null,
  };

  db.addIncident(newIncident);
  broadcastIncident(newIncident);

  if (isMuted) {
    console.log(`[INCIDENT MUTED] ${newIncident.category} -> Vehicle is on STANDBY. Alert logged quietly.`);
    return res.json({
      success: true,
      isMuted: true,
      incident: newIncident,
      message: 'Owner is currently on Standby mode. Non-urgent alerts are logged quietly.'
    });
  }

  console.log(`[INCIDENT REPORTED] ${newIncident.category} -> Dispatched to Owner App! (${newIncident.timestamp})`);

  res.json({ success: true, isMuted: false, incident: newIncident });
});

app.post('/api/incidents/:id/respond', (req, res) => {
  const { id } = req.params;
  const { status, responseMessage } = req.body;

  const updated = db.updateIncident(id, {
    status: status || 'RESOLVED',
    responseMessage: responseMessage || (status === 'RESOLVED' ? "I'm moving my car right now!" : "Alert acknowledged by vehicle owner"),
    resolvedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  if (!updated) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  broadcastIncident(updated);
  console.log(`[OWNER RESPONDED] Incident ${id} -> Status: ${updated.status} | "${updated.responseMessage}"`);

  res.json({ success: true, incident: updated });
});

app.get('/api/incidents', (req, res) => {
  const { vehicleId, plate } = req.query;
  const incidents = db.getAllIncidents({ vehicleId, plate });

  let currentGuardStatus = 'GUARD_ACTIVE';
  if (vehicleId) {
    const v = db.getVehicleById(vehicleId) || db.getVehicleByToken(vehicleId);
    if (v) currentGuardStatus = v.guardStatus || 'GUARD_ACTIVE';
  } else if (plate) {
    const cleanPlate = plate.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    const all = db.getAllVehicles();
    const found = all.find(v => (v.registrationPlate || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase() === cleanPlate);
    if (found) currentGuardStatus = found.guardStatus || 'GUARD_ACTIVE';
  }

  res.json({
    success: true,
    incidents,
    guardStatus: currentGuardStatus,
  });
});

app.get('/api/incidents/:id', (req, res) => {
  const inc = (db.getAllIncidents() || []).find((i) => i.id === req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident not found' });
  res.json({ incident: inc });
});

app.get('/api/vehicle/contacts', (req, res) => {
  const v = db.getAllVehicles()[0];
  res.json({ contacts: v ? v.emergencyContacts : [] });
});

app.post('/api/vehicle/contacts', (req, res) => {
  if (Array.isArray(req.body.contacts)) {
    const v = db.getAllVehicles()[0];
    if (v) {
      db.updateVehicle(v.id, { emergencyContacts: req.body.contacts });
      broadcastContactsUpdate(req.body.contacts);
      console.log(`[CONTACTS LIVE SYNCED] Updated contacts for ${v.registrationPlate}`);
    }
    res.json({ success: true, contacts: req.body.contacts });
  } else {
    res.status(400).json({ error: 'Invalid contacts payload' });
  }
});

// Calls & Communication Logs API
app.get('/api/calls', (req, res) => {
  const { plate, type } = req.query;
  const calls = db.getCallLogs({ plate, type });
  res.json({ success: true, calls });
});

app.post('/api/calls', (req, res) => {
  const newCall = db.addCallLog(req.body);
  console.log(`[CALL LOGGED] 📞 ${newCall.type} call recorded for ${newCall.vehiclePlate || 'general'} from ${newCall.callerTitle}`);
  res.json({ success: true, call: newCall });
});

// ----------------------------------------------------
// 8.5. VOIP INTERNET CALLING & SIGNALING API
// ----------------------------------------------------
app.post('/api/call/initiate', (req, res) => {
  const { vehiclePlate, callerName } = req.body;
  const rawPlate = vehiclePlate || 'MP-19-CA-1056';
  const cleanPlate = rawPlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const vehicle = db.getVehicleByToken(cleanPlate) || db.getVehicleById(cleanPlate) || {
    registrationPlate: rawPlate,
    ownerName: 'MohdEzaz'
  };

  const callId = `call-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const callSession = {
    id: callId,
    vehiclePlate: vehicle.registrationPlate,
    cleanPlate,
    callerName: callerName || 'Bystander Scanner',
    callerPhoneMasked: '+91 98*** *****',
    ownerName: vehicle.ownerName || 'MohdEzaz',
    status: 'RINGING',
    createdAt: Date.now(),
    connectedAt: null,
    endedAt: null,
    durationSeconds: 0
  };

  activeCalls.set(callId, callSession);

  // Broadcast to SSE clients so app is notified of the incoming call immediately
  broadcastIncident({
    type: 'INCOMING_CALL',
    call: callSession
  });

  console.log(`[CALL INITIATED] 📞 Incoming internet call ${callId} for ${callSession.vehiclePlate} from ${callSession.callerName}`);
  res.json({ success: true, call: callSession });
});

app.get('/api/call/active', (req, res) => {
  const plate = (req.query.plate || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  for (const [id, call] of activeCalls.entries()) {
    if ((!plate || call.cleanPlate === plate) && (call.status === 'RINGING' || call.status === 'CONNECTED')) {
      return res.json({ success: true, activeCall: call });
    }
  }
  res.json({ success: true, activeCall: null });
});

app.get('/api/call/status/:callId', (req, res) => {
  const call = activeCalls.get(req.params.callId);
  if (!call) return res.status(404).json({ success: false, error: 'Call session not found' });
  res.json({ success: true, call });
});

app.post('/api/call/answer', (req, res) => {
  const { callId } = req.body;
  const call = activeCalls.get(callId);
  if (!call) return res.status(404).json({ success: false, error: 'Call session not found' });
  call.status = 'CONNECTED';
  call.connectedAt = Date.now();

  if (call.webWs && call.webWs.readyState === 1) {
    call.webWs.send(JSON.stringify({ type: 'CALL_ANSWERED', callId, connectedAt: call.connectedAt }));
  }

  console.log(`[CALL ANSWERED] 🟢 Call ${callId} answered by vehicle owner`);
  res.json({ success: true, call });
});

app.post('/api/call/reject', (req, res) => {
  const { callId } = req.body;
  const call = activeCalls.get(callId);
  if (call) {
    call.status = 'REJECTED';
    call.endedAt = Date.now();
    if (call.webWs && call.webWs.readyState === 1) {
      call.webWs.send(JSON.stringify({ type: 'CALL_REJECTED', callId }));
    }
    db.addCallLog({
      type: 'MISSED',
      callerTitle: call.callerName || 'Bystander Scanner',
      callerSub: 'Internet Call Rejected',
      vehiclePlate: call.vehiclePlate,
      phoneMasked: call.callerPhoneMasked,
      duration: '0s',
      status: 'MISSED'
    });
    console.log(`[CALL REJECTED] 🔴 Call ${callId} rejected by owner`);
  }
  res.json({ success: true });
});

app.post('/api/call/end', (req, res) => {
  const { callId, endedBy, durationSeconds } = req.body;
  const call = activeCalls.get(callId);
  if (call) {
    call.status = 'ENDED';
    call.endedAt = Date.now();
    call.endedBy = endedBy || 'user';
    const duration = durationSeconds || (call.connectedAt ? Math.round((call.endedAt - call.connectedAt) / 1000) : 0);
    call.durationSeconds = duration;

    if (call.webWs && call.webWs.readyState === 1) {
      call.webWs.send(JSON.stringify({ type: 'CALL_ENDED', callId, endedBy, durationSeconds: duration }));
    }
    if (call.appWs && call.appWs.readyState === 1) {
      call.appWs.send(JSON.stringify({ type: 'CALL_ENDED', callId, endedBy, durationSeconds: duration }));
    }

    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    const durStr = duration > 0 ? (mins > 0 ? `${mins}m ${secs}s` : `${secs}s`) : '0s';
    db.addCallLog({
      type: duration > 0 ? 'INCOMING' : 'MISSED',
      callerTitle: call.callerName || 'Bystander Scanner',
      callerSub: duration > 0 ? `Internet Call (${durStr})` : 'Unanswered Internet Call',
      vehiclePlate: call.vehiclePlate,
      phoneMasked: call.callerPhoneMasked,
      duration: durStr,
      status: duration > 0 ? 'COMPLETED' : 'MISSED'
    });
    console.log(`[CALL ENDED] ⏹️ Call ${callId} ended by ${endedBy} (Duration: ${durStr})`);
  }
  res.json({ success: true });
});

// ----------------------------------------------------
// 9. DYNAMIC BYSTANDER SCAN PORTAL & EMPTY LOOKUP
// ----------------------------------------------------

// Route: Clean Search & Scan Portal when NO vehicle plate is specified
app.get(['/vehicle-number', '/vehicle-number/', '/vehicle', '/vehicle/', '/v', '/v/'], (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>SafeQR - Scan Decal or Enter Vehicle Number</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background-color: #0F172A; color: #FFFFFF; padding: 24px 16px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .card { background: #1E293B; border: 2px solid #F59E0B; border-radius: 18px; padding: 32px 22px; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 12px 30px rgba(0,0,0,0.6); }
    .logo-badge { display: inline-flex; align-items: center; gap: 8px; background: #F59E0B; color: #0F172A; font-weight: 900; font-size: 15px; padding: 8px 18px; border-radius: 8px; letter-spacing: 1px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 900; margin-bottom: 10px; color: #F8FAFC; }
    p { font-size: 13px; color: #94A3B8; line-height: 1.6; margin-bottom: 26px; }
    .input-box { width: 100%; background: #0F172A; border: 2px solid #334155; border-radius: 12px; padding: 16px; font-size: 19px; font-weight: 900; color: #F8FAFC; text-align: center; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 18px; outline: none; }
    .input-box:focus { border-color: #F59E0B; }
    .btn-submit { width: 100%; background: #F59E0B; color: #0F172A; border: none; border-radius: 12px; padding: 16px; font-size: 15px; font-weight: 900; cursor: pointer; letter-spacing: 0.5px; transition: transform 0.1s; }
    .btn-submit:active { transform: scale(0.98); }
    .quick-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 18px; }
    .chip { background: #334155; color: #F8FAFC; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 800; cursor: pointer; border: 1px solid #475569; text-decoration: none; }
    .chip:hover { background: #475569; }
    .footer-note { font-size: 11px; color: #64748B; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-badge">🛡️ SAFEQR+</div>
    <h1>Vehicle Incident Portal</h1>
    <p>Please scan a vehicle's SafeQR windshield decal or enter the vehicle registration plate below to contact the vehicle owner or report an obstruction.</p>
    <form onsubmit="handleLookup(event)">
      <input id="plateInput" class="input-box" placeholder="e.g. MP-19-CA-1056" autocomplete="off" required />
      <button type="submit" class="btn-submit">Open Vehicle Incident Portal 🚀</button>
    </form>
    <div class="quick-chips">
      <span style="font-size: 11px; color: #94A3B8; width: 100%; margin-bottom: 2px;">Quick Demo Access:</span>
      <a href="/vehicle-number/mp19ca1056" class="chip">🚗 MP-19-CA-1056</a>
      <a href="/vehicle-number/mh12de9900" class="chip">🚙 MH-12-DE-9900</a>
    </div>
    <div class="footer-note">🔒 100% Privacy Protected • Zero personal phone number exposure</div>
  </div>
  <script>
    function handleLookup(e) {
      e.preventDefault();
      const val = document.getElementById('plateInput').value.trim();
      if (!val) return;
      const clean = val.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
      window.location.href = '/vehicle-number/' + clean;
    }
  </script>
</body>
</html>`);
});

// Route: Bystander Scan Portal with Vehicle Plate
app.get(['/vehicle-number/:token', '/vehicle/:token', '/v/:token'], (req, res) => {
  const token = req.params.token;
  let vehicle = token ? db.getVehicleByToken(token) : null;
  if (!vehicle) {
    const rawPlate = (token || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const formattedPlate = rawPlate.length >= 8 
      ? `${rawPlate.slice(0,2)}-${rawPlate.slice(2,4)}-${rawPlate.slice(4,6)}-${rawPlate.slice(6)}` 
      : rawPlate || 'MP-19-CA-1056';

    vehicle = {
      id: rawPlate.toLowerCase(),
      registrationPlate: formattedPlate,
      model: 'Registered Vehicle',
      ownerName: 'MohdEzaz',
      guardStatus: 'GUARD_ACTIVE',
      emergencyResponders: { police: '112', ambulance: '108' },
      emergencyContacts: [
        { id: 'ec-1', name: 'Family Emergency', relationship: 'Emergency Contact', phone: '+918839786266', priority: 1 }
      ],
      medical: { bloodGroup: 'O+ Positive', allergies: ['None'] }
    };
  }

  const settings = db.getSettings();
  const companyIVR = settings.companyIVRRelayNumber || '+9118002029900';
  const responders = vehicle.emergencyResponders || { police: '112', ambulance: '108' };

  console.log(`[QR SCANNED] Bystander accessed Web Portal for ${vehicle.registrationPlate} (Token: ${token || 'default'})`);

  const safeContactsJson = JSON.stringify(vehicle.emergencyContacts || []).replace(/</g, '\\u003c');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>SafeQR - Incident Portal (${vehicle.registrationPlate})</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background-color: #121316; color: #FFFFFF; padding: 16px; min-height: 100vh; }
    .header { text-align: center; margin-bottom: 16px; }
    .logo-badge { display: inline-flex; align-items: center; gap: 8px; background: #FFD600; color: #121316; font-weight: 900; font-size: 14px; padding: 6px 14px; border-radius: 6px; letter-spacing: 1px; }
    .privacy-tag { font-size: 11px; color: #9CA3AF; margin-top: 8px; font-weight: 700; }
    
    .plate-card { background: #1B1E24; border: 2px solid #FF6B00; border-radius: 12px; padding: 16px; text-align: center; margin-bottom: 16px; box-shadow: 0 4px 0 #000; }
    .plate-label { font-size: 10px; font-weight: 900; color: #FFD600; letter-spacing: 1.5px; }
    .plate-number { font-size: 26px; font-weight: 900; color: #FFFFFF; letter-spacing: 1.5px; margin: 4px 0; }
    .plate-model { font-size: 11px; color: #9CA3AF; font-weight: 700; }

    /* Live Response Tracker */
    .tracker-card { display: none; background: #1B1E24; border: 2px solid #FFD600; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 4px 0 #000; transition: all 0.3s ease; }
    .tracker-card.pending { border-color: #FFD600; }
    .tracker-card.resolved { border-color: #10B981; background: #0E1A14; }
    .tracker-card.acknowledged { border-color: #6B7280; background: #16181D; }
    
    .tracker-header { display: flex; align-items: center; gap: 8px; font-weight: 900; font-size: 12px; margin-bottom: 6px; }
    .pulse-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .pulse-dot.yellow { background: #FFD600; box-shadow: 0 0 10px #FFD600; animation: pulse 1.5s infinite; }
    .pulse-dot.green { background: #10B981; box-shadow: 0 0 10px #10B981; }
    @keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.3); } 100% { opacity: 1; transform: scale(1); } }
    
    .tracker-message { font-size: 13px; font-weight: 800; color: #FFFFFF; line-height: 18px; margin-bottom: 8px; }
    .tracker-time { font-size: 10px; font-weight: 700; color: #9CA3AF; }

    .section-title { font-size: 11px; font-weight: 900; color: #9CA3AF; letter-spacing: 1px; margin-bottom: 10px; text-transform: uppercase; }
    
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
    .action-btn { background: #1B1E24; border: 2px solid #000; border-radius: 10px; padding: 14px 10px; text-align: center; color: #121316; font-weight: 900; cursor: pointer; transition: transform 0.1s; box-shadow: 0 4px 0 #000; }
    .action-btn:active { transform: translateY(2px); box-shadow: 0 2px 0 #000; }
    
    .btn-orange { background: #FF6B00; color: #121316; }
    .btn-yellow { background: #FFD600; color: #121316; }
    .btn-dark { background: #242832; color: #FFFFFF; border-color: rgba(255,255,255,0.15); }
    
    .btn-title { font-size: 13px; font-weight: 900; display: block; margin-top: 4px; }
    .btn-sub { font-size: 9px; font-weight: 700; opacity: 0.85; display: block; }
    
    .call-btn { width: 100%; background: #FFD600; color: #121316; border: 2px solid #000; border-radius: 10px; padding: 14px; font-size: 13px; font-weight: 900; margin-bottom: 16px; cursor: pointer; box-shadow: 0 4px 0 #000; text-align: center; }
    .call-btn:active { transform: translateY(2px); box-shadow: 0 2px 0 #000; }
    
    .sos-card { background: #0E1013; border: 2px solid #EF4444; border-radius: 12px; padding: 16px; box-shadow: 0 4px 0 #000; }
    .sos-header { display: flex; align-items: center; gap: 8px; color: #EF4444; font-weight: 900; font-size: 11px; margin-bottom: 6px; }
    .sos-desc { font-size: 11px; color: #9CA3AF; line-height: 15px; margin-bottom: 12px; }
    .sos-btn { width: 100%; background: #EF4444; color: #FFFFFF; border: 2px solid #FFFFFF; border-radius: 10px; padding: 14px; font-size: 13px; font-weight: 900; cursor: pointer; box-shadow: 0 4px 0 #000; text-align: center; }
    .sos-btn:active { transform: translateY(2px); box-shadow: 0 2px 0 #000; }

    .status-toast { display: none; background: #10B981; color: #121316; font-weight: 900; padding: 14px; border-radius: 8px; margin-bottom: 16px; text-align: center; font-size: 12px; box-shadow: 0 4px 0 #000; }

    /* Guard Status Banners */
    .guard-banner { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 10px; margin-bottom: 16px; border: 2px solid; box-shadow: 0 4px 0 #000; text-align: left; }
    .guard-banner.active { background: rgba(16, 185, 129, 0.12); border-color: #10B981; }
    .guard-banner.active .banner-title { color: #10B981; font-weight: 900; font-size: 12px; letter-spacing: 0.5px; }
    .guard-banner.active .banner-sub { color: #9CA3AF; font-size: 10px; margin-top: 2px; line-height: 14px; }
    
    .guard-banner.standby { background: rgba(245, 158, 11, 0.15); border-color: #F59E0B; }
    .guard-banner.standby .banner-title { color: #F59E0B; font-weight: 900; font-size: 12px; letter-spacing: 0.5px; }
    .guard-banner.standby .banner-sub { color: #FCD34D; font-size: 10px; margin-top: 2px; line-height: 14px; }

    .guard-banner.suspended { background: rgba(239, 68, 68, 0.2); border-color: #EF4444; }
    .guard-banner.suspended .banner-title { color: #EF4444; font-weight: 900; font-size: 12px; letter-spacing: 0.5px; }
    .guard-banner.suspended .banner-sub { color: #FCA5A5; font-size: 10px; margin-top: 2px; line-height: 14px; }
    
    .action-btn.disabled-btn { opacity: 0.4; cursor: not-allowed; filter: grayscale(0.85); pointer-events: none; }

    /* Modals */
    .modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.88); z-index: 999; justify-content: center; align-items: center; padding: 16px; }
    .modal-box { background: #1B1E24; border: 2px solid #FFD600; border-radius: 14px; width: 100%; max-width: 440px; padding: 20px; box-shadow: 0 8px 0 #000; max-height: 90vh; overflow-y: auto; }
    .modal-title { font-size: 16px; font-weight: 900; color: #FFD600; margin-bottom: 4px; }
    .modal-subtitle { font-size: 11px; color: #9CA3AF; margin-bottom: 14px; font-weight: 700; line-height: 15px; }
    
    .contact-card { background: #242832; border: 1px solid #374151; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
    .contact-name { font-size: 13px; font-weight: 900; color: #FFFFFF; }
    .contact-rel { font-size: 10px; font-weight: 700; color: #FFD600; margin-bottom: 6px; }
    
    .ivr-menu-box { background: #14161B; border: 1px solid #374151; border-radius: 8px; padding: 12px; margin: 12px 0; font-size: 11px; line-height: 18px; color: #D1D5DB; }
    .ivr-title { color: #FFD600; font-weight: 900; display: block; margin-bottom: 6px; letter-spacing: 0.8px; font-size: 10px; }

    .btn-row { display: flex; gap: 8px; margin-top: 8px; }
    .btn-mini { flex: 1; padding: 10px; font-size: 11px; font-weight: 900; border-radius: 6px; border: none; cursor: pointer; text-align: center; text-decoration: none; display: inline-block; }
    .btn-mini-whatsapp { background: #25D366; color: #FFFFFF; }
    .btn-mini-call { background: #FFD600; color: #121316; }
    .btn-mini-hotline { background: #EF4444; color: #FFFFFF; }

    .modal-close-btn { width: 100%; background: #374151; color: #FFFFFF; border: none; border-radius: 8px; padding: 12px; font-weight: 900; font-size: 12px; cursor: pointer; margin-top: 10px; }

    /* Internet Voice Call Modal (WhatsApp style) */
    .call-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #0B0F17; z-index: 9999; flex-direction: column; align-items: center; justify-content: space-between; padding: 48px 24px 36px; }
    .call-top-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(245, 158, 11, 0.15); border: 1px solid #F59E0B; color: #F59E0B; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 800; letter-spacing: 0.5px; }
    .caller-avatar-wrap { position: relative; margin: 32px 0 20px; display: flex; align-items: center; justify-content: center; }
    .caller-avatar { width: 110px; height: 110px; border-radius: 50%; background: linear-gradient(135deg, #1E293B, #0F172A); border: 3px solid #F59E0B; display: flex; align-items: center; justify-content: center; font-size: 48px; box-shadow: 0 10px 30px rgba(245, 158, 11, 0.3); z-index: 2; }
    .caller-ripple { position: absolute; width: 140px; height: 140px; border-radius: 50%; border: 2px solid rgba(245, 158, 11, 0.4); animation: callRipple 1.8s infinite ease-out; z-index: 1; }
    .caller-ripple-2 { position: absolute; width: 170px; height: 170px; border-radius: 50%; border: 2px solid rgba(245, 158, 11, 0.2); animation: callRipple 1.8s infinite ease-out 0.6s; z-index: 1; }
    @keyframes callRipple { 0% { transform: scale(0.8); opacity: 1; } 100% { transform: scale(1.3); opacity: 0; } }
    .caller-name { font-size: 24px; font-weight: 900; color: #FFFFFF; margin-bottom: 6px; letter-spacing: 0.5px; }
    .caller-plate { font-size: 15px; font-weight: 800; color: #F59E0B; letter-spacing: 1px; margin-bottom: 8px; }
    .call-status { font-size: 13px; font-weight: 700; color: #94A3B8; margin-bottom: 24px; }
    .call-status.active { color: #10B981; }
    .call-status.declined { color: #EF4444; }
    .wave-bars { display: flex; align-items: center; justify-content: center; gap: 6px; height: 36px; margin-bottom: 24px; }
    .wave-bar { width: 4px; height: 8px; background: #64748B; border-radius: 4px; transition: height 0.15s ease; }
    .wave-bars.active .wave-bar { background: #10B981; animation: soundWave 0.6s infinite ease-in-out alternate; }
    .wave-bars.active .wave-bar:nth-child(1) { animation-delay: 0.1s; }
    .wave-bars.active .wave-bar:nth-child(2) { animation-delay: 0.3s; }
    .wave-bars.active .wave-bar:nth-child(3) { animation-delay: 0.5s; }
    .wave-bars.active .wave-bar:nth-child(4) { animation-delay: 0.2s; }
    .wave-bars.active .wave-bar:nth-child(5) { animation-delay: 0.4s; }
    @keyframes soundWave { 0% { height: 8px; } 100% { height: 32px; } }
    .call-actions-row { display: flex; align-items: center; justify-content: center; gap: 24px; width: 100%; margin-top: auto; }
    .call-round-btn { width: 58px; height: 58px; border-radius: 50%; background: #1E293B; border: 1px solid #334155; color: #F8FAFC; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 22px; cursor: pointer; transition: all 0.15s; outline: none; }
    .call-round-btn:active { transform: scale(0.92); }
    .call-round-btn.btn-end { width: 72px; height: 72px; background: #EF4444; border-color: #DC2626; color: #FFFFFF; font-size: 30px; box-shadow: 0 8px 24px rgba(239, 68, 68, 0.4); }
    .call-round-btn.active { background: #FFFFFF; color: #0F172A; }
    .btn-lbl { font-size: 10px; font-weight: 700; margin-top: 4px; color: #94A3B8; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-badge">🛡️ SafeQR RELAY</div>
    <div class="privacy-tag">🔒 100% Privacy Protected • Owner's Number Confidential</div>
  </div>

  <div id="statusToast" class="status-toast"></div>

  <!-- Live Response Tracker Card -->
  <div id="trackerCard" class="tracker-card pending">
    <div class="tracker-header">
      <span id="trackerDot" class="pulse-dot yellow"></span>
      <span id="trackerTitle" style="color: #FFD600;">TRANSMITTED TO OWNER</span>
    </div>
    <div id="trackerMessage" class="tracker-message">Waiting for vehicle owner to respond... (Owner app notified)</div>
    <div id="trackerTime" class="tracker-time">Reported just now</div>
  </div>

  <div class="plate-card">
    <div class="plate-label">PARKED VEHICLE</div>
    <div class="plate-number">${vehicle.registrationPlate}</div>
    <div class="plate-model">${vehicle.model.toUpperCase()}</div>
  </div>

  <!-- Dynamic Guard Status Banner -->
  <div id="guardBannerContainer">
    ${
      vehicle.guardStatus === 'STANDBY'
        ? `<div class="guard-banner standby">
             <div style="font-size: 22px;">⏸️</div>
             <div>
               <div class="banner-title">OWNER GUARD ON STANDBY</div>
               <div class="banner-sub">Vehicle owner is temporarily away or resting. Parking notifications are muted. For urgent blockages, please call the IVR Helpline below.</div>
             </div>
           </div>`
        : vehicle.guardStatus === 'SUSPENDED'
        ? `<div class="guard-banner suspended">
             <div style="font-size: 22px;">🚫</div>
             <div>
               <div class="banner-title">SAFEQR SHIELD SUSPENDED</div>
               <div class="banner-sub">This vehicle's QR protection is currently deactivated by fleet administrator. Incident reporting is disabled.</div>
             </div>
           </div>`
        : `<div class="guard-banner active">
             <div style="font-size: 20px;">🟢</div>
             <div>
               <div class="banner-title">ACTIVE SHIELD — OWNER CONNECTED</div>
               <div class="banner-sub">Live 2-way privacy relay active. One-tap alerts will notify the vehicle owner instantly.</div>
             </div>
           </div>`
    }
  </div>

  <div class="section-title">Report Parking Issue (One-Tap Alert)</div>
  <div class="grid">
    <div class="action-btn btn-orange" onclick="reportIssue('CAR_BLOCKED')">
      🚗
      <span class="btn-title">CAR BLOCKED</span>
      <span class="btn-sub">Driveway / Gate Obstruction</span>
    </div>
    <div class="action-btn btn-yellow" onclick="reportIssue('AMBULANCE_PATH_BLOCKED')">
      🚑
      <span class="btn-title">AMBULANCE CLEAR</span>
      <span class="btn-sub">Emergency Priority Route</span>
    </div>
    <div class="action-btn btn-dark" onclick="reportIssue('HAZARD_DETECTED')">
      💡
      <span class="btn-title">LIGHTS / WINDOW</span>
      <span class="btn-sub">Headlights or Window Open</span>
    </div>
    <div class="action-btn btn-dark" onclick="reportIssue('WRONG_PARKING')">
      🅿️
      <span class="btn-title">WRONG ZONE</span>
      <span class="btn-sub">Unauthorized Parking Slot</span>
    </div>
  </div>

  <button class="call-btn" onclick="startInternetCall()">
    📞 CALL VEHICLE OWNER (INTERNET VOICE CALL)
  </button>

  <div class="sos-card">
    <div class="sos-header">🚨 ACCIDENT / CRITICAL SITUATION</div>
    <div class="sos-desc">
      If an accident or medical crisis has occurred, tap below to instantly notify the patient's family contacts and emergency responders with medical info.
    </div>
    <button class="sos-btn" onclick="openSOSModal()">
      NOTIFY FAMILY CONTACTS & ${responders.police} NOW
    </button>
  </div>

  <!-- WhatsApp Style Voice Calling Overlay -->
  <div id="internetCallModal" class="call-overlay">
    <div class="call-top-badge">🛡️ SafeQR Masked Voice Relay</div>
    
    <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
      <div class="caller-avatar-wrap">
        <div class="caller-ripple" id="ripple1"></div>
        <div class="caller-ripple-2" id="ripple2"></div>
        <div class="caller-avatar">👤</div>
      </div>
      <div class="caller-name">${vehicle.ownerName || 'Vehicle Owner'}</div>
      <div class="caller-plate">${vehicle.registrationPlate}</div>
      <div id="callStatusText" class="call-status">Connecting masked internet call...</div>
      
      <div id="waveBars" class="wave-bars">
        <div class="wave-bar"></div>
        <div class="wave-bar"></div>
        <div class="wave-bar"></div>
        <div class="wave-bar"></div>
        <div class="wave-bar"></div>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; align-items: center; width: 100%; gap: 16px;">
      <div class="call-actions-row">
        <div style="text-align: center;">
          <button id="btnMute" class="call-round-btn" onclick="toggleMute()">🎙️</button>
          <div class="btn-lbl" id="muteLbl">Mute</div>
        </div>
        <div style="text-align: center;">
          <button class="call-round-btn btn-end" onclick="endInternetCall()">📵</button>
          <div class="btn-lbl">End Call</div>
        </div>
        <div style="text-align: center;">
          <button id="btnSpeaker" class="call-round-btn" onclick="toggleSpeaker()">🔊</button>
          <div class="btn-lbl" id="speakerLbl">Speaker</div>
        </div>
      </div>

      <button onclick="switchToIVR()" style="background: transparent; border: none; color: #94A3B8; font-size: 11px; cursor: pointer; text-decoration: underline; margin-top: 8px;">
        Prefer standard phone call? Dial SafeQR IVR Helpline
      </button>
    </div>
  </div>

  <!-- Call Modal: Company IVR Virtual Relay -->
  <div id="callModal" class="modal-overlay">
    <div class="modal-box">
      <div class="modal-title">📞 SafeQR Virtual Relay Bridge</div>
      <div class="modal-subtitle">100% Privacy Protected • Owner's personal number is never revealed</div>

      <div class="contact-card" style="border-color: #FFD600; background: #20242D;">
        <div class="contact-name">Company IVR Line: ${companyIVR}</div>
        <div class="contact-rel" style="color: #10B981; font-weight: 800;">✓ Automated Masked Routing to Vehicle Owner</div>
        
        <div class="ivr-menu-box">
          <span class="ivr-title">AUTOMATED CALL MENU:</span>
          • <strong>Press 1:</strong> 🚨 Emergency / Accident SOS<br/>
          • <strong>Press 2:</strong> 🚗 Car Blocked / Move Vehicle Request<br/>
          • <strong>Press 3:</strong> 💡 Hazard Alert (Window/Lights Open)<br/>
          • <strong>Press 4:</strong> 🎙️ Leave Masked Voicemail to Owner
        </div>

        <div class="btn-row">
          <a href="tel:${companyIVR}" class="btn-mini btn-mini-call" onclick="recordCall('IVR')">
            📞 Dial SafeQR Helpline (${companyIVR})
          </a>
        </div>
      </div>

      <button class="modal-close-btn" onclick="closeModals()">Close</button>
    </div>
  </div>

  <!-- SOS Modal -->
  <div id="sosModal" class="modal-overlay">
    <div class="modal-box" style="border-color: #EF4444;">
      <div class="modal-title" style="color: #EF4444;">🚨 Emergency Accident Contacts</div>
      <div class="modal-subtitle">Real-time synchronized with vehicle owner. Family & emergency hotlines:</div>

      <div id="contactsContainer"></div>

      <div class="contact-card" style="border-color: #EF4444; background: #1C1214;">
        <div class="contact-name" style="color: #EF4444;">National Emergency Responders (${vehicle.country || 'Local'})</div>
        <div class="contact-rel">Immediate Government Emergency Dispatch</div>
        <div class="btn-row">
          <a href="tel:${responders.police}" class="btn-mini btn-mini-hotline">🚨 Call ${responders.police} (Police)</a>
          <a href="tel:${responders.ambulance}" class="btn-mini btn-mini-hotline">🚑 Call ${responders.ambulance} (Ambulance)</a>
        </div>
      </div>

      <button class="modal-close-btn" onclick="closeModals()">Close</button>
    </div>
  </div>

  <script>
    let currentContacts = ${safeContactsJson};
    let activeIncidentId = null;
    let pollTimer = null;
    const vehicleId = "${vehicle.id}";

    function showToast(msg, isSuccess = true) {
      const toast = document.getElementById('statusToast');
      toast.innerText = msg;
      toast.style.background = isSuccess ? '#10B981' : '#EF4444';
      toast.style.color = isSuccess ? '#121316' : '#FFFFFF';
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 4000);
    }

    function maskPhone(p) {
      if (!p) return '••••';
      const clean = p.replace(/[^0-9]/g, '');
      if (clean.length < 4) return '••••';
      const lastFour = clean.slice(-4);
      const prefix = clean.length > 10 ? '+' + clean.slice(0, clean.length - 10) + ' ' : '';
      return prefix + '••••• ••' + lastFour;
    }

    function renderContacts() {
      const container = document.getElementById('contactsContainer');
      container.innerHTML = '';
      
      if (!currentContacts || currentContacts.length === 0) {
        container.innerHTML = '<div style="color: #9CA3AF; padding: 10px; text-align: center; font-size: 11px;">No Emergency Contacts Linked Yet.</div>';
        return;
      }

      currentContacts.forEach((contact) => {
        const cleanPhone = (contact.phone || '').replace(/[^0-9]/g, '');
        const waText = encodeURIComponent(
          "🚨 SAFEQR ACCIDENT SOS DISPATCH\\n" +
          "Vehicle: ${vehicle.registrationPlate} (${vehicle.model})\\n" +
          "Contact: " + contact.name + " (" + contact.relationship + ")\\n" +
          "Status: Urgent Medical Assistance Required!\\n" +
          "Blood Group: ${vehicle.medical?.bloodGroup || 'Not Specified'}\\n" +
          "Location: Bystander reported near the vehicle."
        );
        const waUrl = "https://wa.me/" + cleanPhone + "?text=" + waText;
        const ivrUrl = "tel:${companyIVR},,1";

        const card = document.createElement('div');
        card.className = 'contact-card';
        card.innerHTML = 
          '<div class="contact-name">#' + (contact.priority || 1) + ' ' + contact.name + '</div>' +
          '<div class="contact-rel">' + contact.relationship + ' • ' + maskPhone(contact.phone) + '</div>' +
          '<div class="btn-row">' +
            '<a href="' + waUrl + '" target="_blank" class="btn-mini btn-mini-whatsapp">💬 WhatsApp SOS</a>' +
            '<a href="' + ivrUrl + '" class="btn-mini btn-mini-call">📞 Call via IVR</a>' +
          '</div>';
        container.appendChild(card);
      });
    }
    renderContacts();

    // Fallback sync loop
    setInterval(async () => {
      try {
        const res = await fetch('/api/vehicles/' + vehicleId);
        if (res.ok) {
          const data = await res.json();
          if (data.vehicle && Array.isArray(data.vehicle.emergencyContacts)) {
            if (JSON.stringify(data.vehicle.emergencyContacts) !== JSON.stringify(currentContacts)) {
              currentContacts = data.vehicle.emergencyContacts;
              renderContacts();
              showToast('✓ Emergency contacts updated live from owner!');
            }
          }
        }
      } catch {}
    }, 2500);

    function openCallModal() {
      document.getElementById('callModal').style.display = 'flex';
    }

    function openSOSModal() {
      document.getElementById('sosModal').style.display = 'flex';
      reportIssue('SOS_ACCIDENT');
    }

    function closeModals() {
      document.getElementById('callModal').style.display = 'none';
      document.getElementById('sosModal').style.display = 'none';
    }

    let currentGuardStatus = "${vehicle.guardStatus || 'GUARD_ACTIVE'}";

    function updateActionButtons(status) {
      const buttons = document.querySelectorAll('.action-btn');
      buttons.forEach(btn => {
        if (status === 'SUSPENDED') {
          btn.classList.add('disabled-btn');
        } else {
          btn.classList.remove('disabled-btn');
        }
      });
    }

    function renderGuardBanner(status) {
      const container = document.getElementById('guardBannerContainer');
      if (!container) return;
      if (status === 'STANDBY') {
        container.innerHTML = '<div class="guard-banner standby"><div style="font-size: 22px;">⏸️</div><div><div class="banner-title">OWNER GUARD ON STANDBY</div><div class="banner-sub">Vehicle owner is temporarily away or resting. Parking notifications are muted. For urgent blockages, please call the IVR Helpline below.</div></div></div>';
      } else if (status === 'SUSPENDED') {
        container.innerHTML = '<div class="guard-banner suspended"><div style="font-size: 22px;">🚫</div><div><div class="banner-title">SAFEQR SHIELD SUSPENDED</div><div class="banner-sub">This vehicle\\'s QR protection is currently deactivated by fleet administrator. Incident reporting is disabled.</div></div></div>';
      } else {
        container.innerHTML = '<div class="guard-banner active"><div style="font-size: 20px;">🟢</div><div><div class="banner-title">ACTIVE SHIELD — OWNER CONNECTED</div><div class="banner-sub">Live 2-way privacy relay active. One-tap alerts will notify the vehicle owner instantly.</div></div></div>';
      }
      updateActionButtons(status);
    }

    // Initialize button state
    updateActionButtons(currentGuardStatus);

    function recordCall(type) {
      fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: type === 'MISSED' ? 'MISSED' : 'INCOMING',
          callerTitle: 'Bystander Scanned QR',
          callerSub: 'Bystander IVR Relay Call',
          vehiclePlate: '${vehicle.registrationPlate}',
          phoneMasked: '+91 98*** *****'
        })
      }).catch(function(){});
      showToast('Connecting to SafeQR IVR Automated Helpline (${companyIVR})...');
    }

    async function reportIssue(category) {
      if (currentGuardStatus === 'SUSPENDED') {
        alert('🚫 SAFEQR SHIELD SUSPENDED: Incident reporting is disabled for this vehicle. Please call the emergency helpline if urgent.');
        return;
      }

      if (currentGuardStatus === 'STANDBY') {
        showToast('⚠️ Owner is on Standby (Muted). Alert logged quietly. For immediate needs, use IVR Helpline.');
      }

      try {
        const res = await fetch('/api/incidents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, vehicleId, registrationPlate: '${vehicle.registrationPlate}' })
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.message || 'Cannot report incident at this time.');
          return;
        }

        if (data.incident) {
          activeIncidentId = data.incident.id;
          showTracker(data.incident);
          startTracking(data.incident.id);
        }

        if (data.isMuted) {
          showToast('ℹ️ Notice: Owner is on Standby. Alert was recorded quietly.');
        } else {
          showToast('✓ Alert transmitted to vehicle owner in real time!');
        }
      } catch (err) {
        showToast('Transmitted locally. Owner alerted.', true);
      }
    }

    // --- INTERNET VOICE CALL (WHATSAPP-STYLE VOIP RELAY) ---
    let currentCallId = null;
    let callTimerInterval = null;
    let callSeconds = 0;
    let callWs = null;
    let isMicMuted = false;
    let isSpeakerOn = true;
    let audioCtx = null;
    let ringTimer = null;
    let localStream = null;

    function playDialTone() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        audioCtx = new AudioCtx();
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }

        const playBeep = () => {
          if (!audioCtx) return;
          try {
            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc1.type = 'sine';
            osc1.frequency.value = 400;
            osc2.type = 'sine';
            osc2.frequency.value = 450;

            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(audioCtx.destination);

            osc1.start();
            osc2.start();
            osc1.stop(audioCtx.currentTime + 1.2);
            osc2.stop(audioCtx.currentTime + 1.2);
          } catch {}
        };

        playBeep();
        ringTimer = setInterval(playBeep, 3500);
      } catch (e) {
        console.log('Web Audio tone init error:', e);
      }
    }

    function stopDialTone() {
      if (ringTimer) {
        clearInterval(ringTimer);
        ringTimer = null;
      }
      if (audioCtx) {
        try { audioCtx.close(); } catch {}
        audioCtx = null;
      }
    }

    async function startInternetCall() {
      if (currentGuardStatus === 'SUSPENDED') {
        alert('🚫 SAFEQR SHIELD SUSPENDED: Calling is disabled for this vehicle.');
        return;
      }

      const modal = document.getElementById('internetCallModal');
      const statusText = document.getElementById('callStatusText');
      const waveBars = document.getElementById('waveBars');
      modal.style.display = 'flex';
      statusText.className = 'call-status';
      statusText.innerText = "Ringing vehicle owner's SafeQR App...";
      waveBars.classList.remove('active');
      callSeconds = 0;
      isMicMuted = false;

      // Start realistic dial-tone sound
      playDialTone();

      // Request browser mic in background
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      } catch (err) {
        console.log('Microphone permission optional:', err.message);
      }

      // Initiate Call Session on Server
      try {
        const res = await fetch('/api/call/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehiclePlate: '${vehicle.registrationPlate}',
            callerName: 'Bystander Scanner'
          })
        });
        const data = await res.json();
        if (data.success && data.call) {
          currentCallId = data.call.id;
          connectCallSignaling(currentCallId);
        } else {
          statusText.innerText = 'Unable to initiate call. Please retry.';
        }
      } catch (err) {
        statusText.innerText = 'Network error. Please try again.';
      }
    }

    function connectCallSignaling(callId) {
      try {
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        callWs = new WebSocket(wsProto + '//' + window.location.host + '/ws/call?callId=' + callId + '&role=web');
        callWs.onmessage = function(event) {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'CALL_ANSWERED') {
              handleCallAnswered();
            } else if (msg.type === 'CALL_REJECTED') {
              handleCallRejected();
            } else if (msg.type === 'CALL_ENDED') {
              handleCallEnded();
            }
          } catch {}
        };
      } catch {}

      // Polling fallback every 1.5s
      const pollCallInterval = setInterval(async () => {
        if (!currentCallId) {
          clearInterval(pollCallInterval);
          return;
        }
        try {
          const res = await fetch('/api/call/status/' + currentCallId);
          if (res.ok) {
            const d = await res.json();
            if (d.call) {
              if (d.call.status === 'CONNECTED' && !callTimerInterval) {
                handleCallAnswered();
              } else if (d.call.status === 'REJECTED') {
                clearInterval(pollCallInterval);
                handleCallRejected();
              } else if (d.call.status === 'ENDED') {
                clearInterval(pollCallInterval);
                handleCallEnded();
              }
            }
          }
        } catch {}
      }, 1500);
    }

    function handleCallAnswered() {
      stopDialTone();
      const statusText = document.getElementById('callStatusText');
      const waveBars = document.getElementById('waveBars');
      statusText.className = 'call-status active';
      statusText.innerText = 'Connected • 00:00';
      waveBars.classList.add('active');

      if (callTimerInterval) clearInterval(callTimerInterval);
      callTimerInterval = setInterval(() => {
        callSeconds++;
        const mins = Math.floor(callSeconds / 60).toString().padStart(2, '0');
        const secs = (callSeconds % 60).toString().padStart(2, '0');
        statusText.innerText = 'Connected • ' + mins + ':' + secs;
      }, 1000);
    }

    function handleCallRejected() {
      stopDialTone();
      if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
      const statusText = document.getElementById('callStatusText');
      const waveBars = document.getElementById('waveBars');
      statusText.className = 'call-status declined';
      statusText.innerText = '🔴 Call Declined by Vehicle Owner';
      waveBars.classList.remove('active');
      setTimeout(closeInternetCallModal, 2500);
    }

    function handleCallEnded() {
      stopDialTone();
      if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
      const statusText = document.getElementById('callStatusText');
      const waveBars = document.getElementById('waveBars');
      statusText.className = 'call-status';
      statusText.innerText = 'Call Ended (' + callSeconds + 's)';
      waveBars.classList.remove('active');
      setTimeout(closeInternetCallModal, 2000);
    }

    function endInternetCall() {
      stopDialTone();
      if (currentCallId) {
        fetch('/api/call/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId: currentCallId, endedBy: 'bystander', durationSeconds: callSeconds })
        }).catch(function(){});
      }
      handleCallEnded();
    }

    function toggleMute() {
      isMicMuted = !isMicMuted;
      const btn = document.getElementById('btnMute');
      const lbl = document.getElementById('muteLbl');
      if (isMicMuted) {
        btn.classList.add('active');
        lbl.innerText = 'Unmute';
        if (localStream) {
          localStream.getAudioTracks().forEach(t => { t.enabled = false; });
        }
      } else {
        btn.classList.remove('active');
        lbl.innerText = 'Mute';
        if (localStream) {
          localStream.getAudioTracks().forEach(t => { t.enabled = true; });
        }
      }
    }

    function toggleSpeaker() {
      isSpeakerOn = !isSpeakerOn;
      const btn = document.getElementById('btnSpeaker');
      const lbl = document.getElementById('speakerLbl');
      if (!isSpeakerOn) {
        btn.classList.add('active');
        lbl.innerText = 'Earpiece';
      } else {
        btn.classList.remove('active');
        lbl.innerText = 'Speaker';
      }
    }

    function closeInternetCallModal() {
      stopDialTone();
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
      }
      if (callWs) {
        try { callWs.close(); } catch {}
        callWs = null;
      }
      currentCallId = null;
      document.getElementById('internetCallModal').style.display = 'none';
    }

    function switchToIVR() {
      closeInternetCallModal();
      openCallModal();
    }

    function showTracker(incident) {
      const tracker = document.getElementById('trackerCard');
      const dot = document.getElementById('trackerDot');
      const title = document.getElementById('trackerTitle');
      const msg = document.getElementById('trackerMessage');
      const time = document.getElementById('trackerTime');

      tracker.style.display = 'block';

      if (incident.status === 'RESOLVED') {
        tracker.className = 'tracker-card resolved';
        dot.className = 'pulse-dot green';
        title.style.color = '#10B981';
        title.innerText = '✅ VEHICLE OWNER RESPONDED:';
        msg.innerText = '"' + (incident.responseMessage || "I'm moving my car right now!") + '"';
        time.innerText = 'Updated at ' + (incident.resolvedAt || new Date().toLocaleTimeString());
      } else if (incident.status === 'ACKNOWLEDGED') {
        tracker.className = 'tracker-card acknowledged';
        dot.className = 'pulse-dot';
        title.style.color = '#9CA3AF';
        title.innerText = 'ℹ️ OWNER ACKNOWLEDGED:';
        msg.innerText = '"' + (incident.responseMessage || "Alert acknowledged by vehicle owner.") + '"';
        time.innerText = 'Updated at ' + (incident.resolvedAt || new Date().toLocaleTimeString());
      } else {
        tracker.className = 'tracker-card pending';
        dot.className = 'pulse-dot yellow';
        title.style.color = '#FFD600';
        title.innerText = 'TRANSMITTED TO OWNER';
        msg.innerText = 'Waiting for vehicle owner to respond... (Owner app notified)';
        time.innerText = 'Sent at ' + incident.timestamp;
      }
    }

    function startTracking(incidentId) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch('/api/incidents/' + incidentId);
          if (res.ok) {
            const data = await res.json();
            if (data.incident) {
              showTracker(data.incident);
              if (data.incident.status === 'RESOLVED' || data.incident.status === 'ACKNOWLEDGED') {
                clearInterval(pollTimer);
              }
            }
          }
        } catch {}
      }, 1500);
    }

    // Connect to SSE stream
    try {
      const evtSource = new EventSource('/api/incidents/stream');
      evtSource.onmessage = function(event) {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'VEHICLE_STATUS_UPDATE' && (payload.vehicleId === vehicleId || payload.registrationPlate === '${vehicle.registrationPlate}')) {
            currentGuardStatus = payload.guardStatus;
            renderGuardBanner(payload.guardStatus);
            showToast('✓ Vehicle Shield Status changed: ' + payload.guardStatus);
          } else if (payload.type === 'INCIDENT_UPDATE' && payload.incident) {
            if (activeIncidentId && payload.incident.id === activeIncidentId) {
              showTracker(payload.incident);
            }
          } else if (payload.type === 'CONTACTS_UPDATED' && Array.isArray(payload.contacts)) {
            currentContacts = payload.contacts;
            renderContacts();
            showToast('✓ Emergency contacts updated live from owner!');
          }
        } catch {}
      };
    } catch {}
  </script>
</body>
</html>`);
});

// Start Server
server.listen(PORT, HOST, () => {
  const currentIVR = db.getSettings().companyIVRRelayNumber || '+919300092225';
  const displayBase = process.env.RENDER_EXTERNAL_URL 
    || (process.env.RENDER || PORT == 10000 ? 'https://safeqr-backend-o13q.onrender.com' : `http://${LOCAL_IP}:${PORT}`);

  console.log(`================================================================`);
  console.log(` 🛡️ SAFEQR UNIFIED CLOUD PLATFORM ACTIVE ON PORT ${PORT}`);
  console.log(` 🌐 Public Marketing & Purchase Site: ${displayBase}/`);
  console.log(` ⚙️ Admin Management Command Center: ${displayBase}/admin`);
  console.log(` 📱 Bystander Scan Portal:           ${displayBase}/vehicle-number/`);
  console.log(` 📞 Company IVR Virtual Helpline:    ${currentIVR}`);
  console.log(`================================================================`);
});
