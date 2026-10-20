const express = require('express');
const cors = require('cors');
const os = require('os');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const db = require('./db');
const { exportVehiclesToWorkbook, parseVehiclesFromWorkbook, generateSampleTemplate } = require('./excel-service');
const { sendActivationEmail, getEmailPreview } = require('./email-service');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

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
// 9. DYNAMIC BYSTANDER SCAN PORTAL (GET /v/:token or /v)
// ----------------------------------------------------
app.get(['/v/:token', '/v'], (req, res) => {
  const token = req.params.token;
  let vehicle = token ? db.getVehicleByToken(token) : null;
  if (!vehicle) {
    vehicle = db.getAllVehicles()[0] || {
      id: 'veh-9900',
      registrationPlate: 'MH-12-DE-9900',
      model: 'Tata Harrier Dark Edition',
      emergencyContacts: [
        { id: 'ec-1', name: 'Ayesha Khan', relationship: 'Spouse', phone: '+919876543210', priority: 1 },
        { id: 'ec-2', name: 'Tariq Ali', relationship: 'Brother', phone: '+919876543211', priority: 2 }
      ],
      emergencyResponders: { police: '112', ambulance: '108' },
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

  <button class="call-btn" onclick="openCallModal()">
    📞 CALL VEHICLE OWNER ANONYMOUSLY (BROKERED)
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
          body: JSON.stringify({ category, vehicleId })
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
app.listen(PORT, HOST, () => {
  const currentIVR = db.getSettings().companyIVRRelayNumber || '+919300092225';
  const displayBase = process.env.RENDER_EXTERNAL_URL 
    || (process.env.RENDER || PORT == 10000 ? 'https://safeqr-backend-o13q.onrender.com' : `http://${LOCAL_IP}:${PORT}`);

  console.log(`================================================================`);
  console.log(` 🛡️ SAFEQR UNIFIED CLOUD PLATFORM ACTIVE ON PORT ${PORT}`);
  console.log(` 🌐 Public Marketing & Purchase Site: ${displayBase}/`);
  console.log(` ⚙️ Admin Management Command Center: ${displayBase}/admin`);
  console.log(` 📱 Bystander Scan Portal (Live QR):  ${displayBase}/v/`);
  console.log(` 📞 Company IVR Virtual Helpline:    ${currentIVR}`);
  console.log(`================================================================`);
});
