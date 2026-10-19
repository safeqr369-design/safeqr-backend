const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'safeqr_db.json');

// Default Master System & App Configuration
const DEFAULT_CONFIG = {
  helpline: {
    tollfree: '1800 202 9900',
    whatsapp: '+91 88397 86266',
    email: 'support@safeqr.in',
    police: '112',
    ambulance: '108',
    appName: 'SafeQR+',
    tagline: "India's #1 Smart Vehicle QR Safety Shield"
  },
  pricing: {
    starterTitle: 'Starter Reflective Decal',
    starterSubtitle: 'Single Windshield Decal with QR Shield',
    starterPrice: 199,
    starterOriginalPrice: 499,
    starterBadge: 'BEST VALUE',
    starterFeatures: [
      '1x Exterior Grade Reflective Decal',
      '100% Number Masking Privacy',
      'Instant SMS & WhatsApp Alert Dispatch',
      'Emergency Medical Vault Integration',
      '3 Years Outdoor UV Shield Warranty'
    ],
    proTitle: 'Pro Dual Holographic Shield',
    proSubtitle: 'Front & Rear Windshield 2-Pack',
    proPrice: 399,
    proOriginalPrice: 799,
    proBadge: 'MOST POPULAR',
    proFeatures: [
      '2x Dual Holographic Windshield Shields',
      'Unlimited Masked Calling & Callback Hub',
      'Accident & Wrong Parking Instant SOS',
      'Priority IVR Virtual Number Routing',
      'Lifetime Cloud Decal Replacement'
    ],
    freeCallsAllowance: 3
  },
  demoVideo: {
    title: 'How SafeQR Works & Mask Calling Demo',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    description: '1. Affix QR sticker to car windshield.\n2. When blocked, bystanders scan the QR.\n3. SafeQR sends an instant alert to your phone and enables masked calling.\n4. You move your car without any arguments or spam!'
  },
  banners: [
    {
      id: 'b1',
      title: 'Call Securely with\nMask Calling',
      subtitle: 'Your mobile number stays 100% confidential.',
      badge: '🛡️ Zero Spam Guaranteed',
      badgeBg: '#DCFCE7',
      badgeColor: '#15803D',
      icon: 'account-tie-voice',
      iconBg: '#FEF9C3',
      iconColor: '#854D0E',
      borderColor: '#FEF08A',
      imageUrl: '',
      isFullImage: false
    },
    {
      id: 'b2',
      title: 'Instant Accident &\nEmergency SOS',
      subtitle: '1-Tap emergency alerts with live GPS & medical vault.',
      badge: '🚨 24/7 Live Emergency',
      badgeBg: '#FFE4E6',
      badgeColor: '#BE123C',
      icon: 'ambulance',
      iconBg: '#FEE2E2',
      iconColor: '#DC2626',
      borderColor: '#FECDD3',
      imageUrl: '',
      isFullImage: false
    },
    {
      id: 'b3',
      title: 'Wrong Parking? No\nArguments Needed',
      subtitle: 'Direct anonymous notifications without revealing phone numbers.',
      badge: '🚗 Smart Traffic Flow',
      badgeBg: '#E0F2FE',
      badgeColor: '#0369A1',
      icon: 'car-brake-alert',
      iconBg: '#E0F2FE',
      iconColor: '#0284C7',
      borderColor: '#BAE6FD',
      imageUrl: '',
      isFullImage: false
    },
    {
      id: 'b4',
      title: 'Doorstep Reflective\nDecal Delivery',
      subtitle: 'High-durability all-weather reflective holographic sticker.',
      badge: '📦 Fast All-India Dispatch',
      badgeBg: '#FFEDD5',
      badgeColor: '#C2410C',
      icon: 'qrcode-scan',
      iconBg: '#FFF7ED',
      iconColor: '#EA580C',
      borderColor: '#FED7AA',
      imageUrl: '',
      isFullImage: false
    },
    {
      id: 'b5',
      title: 'Emergency Medical\nVault Protection',
      subtitle: 'Blood group & critical info ready for first responders.',
      badge: '🩺 Encrypted Life Vault',
      badgeBg: '#D1FAE5',
      badgeColor: '#047857',
      icon: 'heart-pulse',
      iconBg: '#ECFDF5',
      iconColor: '#059669',
      borderColor: '#A7F3D0',
      imageUrl: '',
      isFullImage: false
    }
  ],
  onboarding: [
    {
      id: 's1',
      title: 'Blocked by a Wrongly\nParked Car?',
      subtitle: 'Spot an issue and take quick action no arguments, no waiting.',
      imageUrl: '',
      isFullImage: false,
      buttonText: 'Next'
    },
    {
      id: 's2',
      title: 'Quick, Masked &\nDirect Calling',
      subtitle: 'Connect instantly without sharing your personal number or privacy.',
      imageUrl: '',
      isFullImage: false,
      buttonText: 'Next'
    },
    {
      id: 's3',
      title: 'Your Details are Always\n100% Safe with Us',
      subtitle: 'Smart QR technology protecting car owners across India.',
      imageUrl: '',
      isFullImage: false,
      buttonText: 'Get Started'
    }
  ],
  paymentGateways: {
    activeGateway: 'mock',
    testMode: true,
    currency: 'INR',
    razorpay: {
      keyId: 'rzp_test_sample123',
      keySecret: 'rzp_sec_mock_456789',
      webhookSecret: 'whsec_sample'
    },
    cashfree: {
      appId: 'TEST_CF_APP_8839',
      secretKey: 'cfsk_ma_test_sample'
    },
    stripe: {
      publishableKey: 'pk_test_sample123456',
      secretKey: 'sk_test_sample987654'
    },
    upi: {
      vpa: 'safeqr@okaxis',
      merchantName: 'SafeQR Technologies India'
    }
  },
  otpServices: {
    activeSmsGateway: 'mock',
    mockOtp: '1056',
    fast2sms: {
      apiKey: ''
    },
    msg91: {
      authKey: '',
      senderId: 'SAFEQR',
      templateId: ''
    },
    twilio: {
      accountSid: '',
      authToken: '',
      fromNumber: ''
    },
    emailSmtp: {
      host: 'smtp.gmail.com',
      port: 587,
      user: 'notifications@safeqr.in',
      pass: '••••••••',
      sender: 'SafeQR Alerts <notifications@safeqr.in>',
      secure: false
    }
  }
};

// Default initial state
const DEFAULT_DB = {
  config: DEFAULT_CONFIG,
  settings: {
    companyIVRRelayNumber: '+9118002029900',
    ivrMenu: [
      { key: '1', label: 'Emergency / Accident SOS', action: 'DISPATCH_SOS' },
      { key: '2', label: 'Car Blocked / Move Vehicle', action: 'MOVE_CAR' },
      { key: '3', label: 'Safety Hazard (Window/Lights)', action: 'HAZARD' },
      { key: '4', label: 'Record Masked Voicemail', action: 'VOICEMAIL' }
    ],
    countryResponders: {
      'India': { police: '112', ambulance: '108', defaultIVR: '+9118002029900' },
      'United States': { police: '911', ambulance: '911', defaultIVR: '+18005550199' },
      'United Kingdom': { police: '999', ambulance: '999', defaultIVR: '+448000188900' },
      'United Arab Emirates': { police: '999', ambulance: '998', defaultIVR: '+9718007233' },
      'Canada': { police: '911', ambulance: '911', defaultIVR: '+18005550199' },
      'Australia': { police: '000', ambulance: '000', defaultIVR: '+611800123456' },
      'Saudi Arabia': { police: '999', ambulance: '997', defaultIVR: '+966800123456' },
      'Germany': { police: '110', ambulance: '112', defaultIVR: '+49800123456' }
    },
    adminCredentials: {
      username: 'admin',
      password: 'safeqr@2026'
    }
  },
  vehicles: [
    {
      id: 'veh-9900',
      orderId: 'ORD-2026-0001',
      activationKey: 'SQR-KEY-9900-A1B2',
      qrToken: 'VID-MH12DE9900',
      registrationPlate: 'MH-12-DE-9900',
      model: 'Tata Harrier Dark Edition',
      vehicleType: 'SUV',
      ownerName: 'Muhammad Sadiq',
      ownerPhone: '+919876543210',
      ownerEmail: 'owner@example.com',
      address: '14 MG Road, Koregaon Park',
      city: 'Pune',
      state: 'Maharashtra',
      country: 'India',
      guardStatus: 'GUARD_ACTIVE',
      medical: {
        bloodGroup: 'O+ Positive',
        allergies: ['None'],
        insurancePolicyId: 'ICICI-LOMB-98231',
        emergencyNote: 'No critical medical preconditions.'
      },
      emergencyContacts: [
        { id: 'ec-1', name: 'Ayesha Khan', relationship: 'Spouse', phone: '+919876543210', priority: 1 },
        { id: 'ec-2', name: 'Tariq Ali', relationship: 'Brother', phone: '+919876543211', priority: 2 }
      ],
      emergencyResponders: {
        police: '112',
        ambulance: '108'
      },
      createdAt: '2026-10-10 10:00 AM',
      paidAmount: 499
    }
  ],
  orders: [
    {
      orderId: 'ORD-2026-0001',
      vehiclePlate: 'MH-12-DE-9900',
      ownerName: 'Muhammad Sadiq',
      ownerEmail: 'owner@example.com',
      ownerPhone: '+919876543210',
      plan: 'Pro Lifetime Safety Shield (4x Holographic Decals)',
      amount: 499,
      currency: 'INR',
      status: 'PAID',
      activationKey: 'SQR-KEY-9900-A1B2',
      createdAt: '2026-10-10 10:00 AM'
    },
    {
      orderId: 'ORD-2026-8821',
      vehiclePlate: 'MH-12-DE-9900',
      ownerName: 'MohdEzaz',
      ownerEmail: 'mohdezaz@safeqr.in',
      ownerPhone: '8839786266',
      plan: 'Pro Dual Holographic Shield (2-Pack)',
      amount: 399,
      currency: 'INR',
      status: 'PAID',
      deliveryStatus: 'SHIPPED',
      trackingId: 'TRK-IN-98231',
      activationKey: 'SQR-KEY-9900-A1B2',
      createdAt: '2026-10-15 02:30 PM'
    }
  ],
  users: [
    {
      id: 'usr-8839786266',
      phone: '8839786266',
      name: 'MohdEzaz',
      pincode: '485001',
      state: 'Madhya Pradesh',
      city: 'Satna',
      address: 'Nazerabad satna lane no 6',
      medical: {
        bloodGroup: 'O+ Positive',
        allergies: ['None'],
        insurancePolicyId: 'ICICI-98231',
        emergencyNote: 'No critical preconditions.'
      },
      emergencyContacts: [
        { id: 'ec-1', name: 'Ayesha Khan', relationship: 'Spouse', phone: '+919876543210', priority: 1, isVerified: true },
        { id: 'ec-2', name: 'Tariq Ali', relationship: 'Brother', phone: '+919876543211', priority: 2, isVerified: true }
      ],
      createdAt: '2026-10-10 10:00 AM'
    }
  ],
  otps: {},
  incidents: []
};

class SafeQRDatabase {
  constructor() {
    this.ensureDataDir();
    this.data = this.load();
  }

  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed.vehicles || parsed.vehicles.length === 0) {
          parsed.vehicles = JSON.parse(JSON.stringify(DEFAULT_DB.vehicles));
        }
        if (!parsed.users || parsed.users.length === 0) {
          parsed.users = JSON.parse(JSON.stringify(DEFAULT_DB.users));
        }
        if (!parsed.otps) parsed.otps = {};
        if (!parsed.orders || parsed.orders.length === 0) {
          parsed.orders = JSON.parse(JSON.stringify(DEFAULT_DB.orders));
        }
        if (!parsed.config) {
          parsed.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        } else {
          parsed.config = {
            ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
            ...parsed.config,
            helpline: { ...DEFAULT_CONFIG.helpline, ...(parsed.config.helpline || {}) },
            pricing: { ...DEFAULT_CONFIG.pricing, ...(parsed.config.pricing || {}) },
            demoVideo: { ...DEFAULT_CONFIG.demoVideo, ...(parsed.config.demoVideo || {}) },
            paymentGateways: { ...DEFAULT_CONFIG.paymentGateways, ...(parsed.config.paymentGateways || {}) },
            otpServices: { ...DEFAULT_CONFIG.otpServices, ...(parsed.config.otpServices || {}) }
          };
        }
        return parsed;
      }
    } catch (err) {
      console.error('[DB] Error reading safeqr_db.json, using fallback defaults:', err.message);
    }
    this.save(DEFAULT_DB);
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }

  save(dataToSave) {
    try {
      this.ensureDataDir();
      const payload = dataToSave || this.data;
      fs.writeFileSync(DB_FILE, JSON.stringify(payload, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('[DB] Failed to save database:', err.message);
      return false;
    }
  }

  // --- Master App & System Configuration ---
  getConfig() {
    if (!this.data.config) {
      this.data.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      this.save();
    }
    return this.data.config;
  }

  updateConfig(updates = {}) {
    if (!this.data.config) {
      this.data.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    for (const key of Object.keys(updates)) {
      if (typeof updates[key] === 'object' && !Array.isArray(updates[key]) && updates[key] !== null) {
        this.data.config[key] = {
          ...(this.data.config[key] || {}),
          ...updates[key]
        };
      } else {
        this.data.config[key] = updates[key];
      }
    }
    this.save();
    return this.data.config;
  }

  // --- Settings ---
  getSettings() {
    return this.data.settings || DEFAULT_DB.settings;
  }

  updateSettings(newSettings) {
    this.data.settings = {
      ...this.data.settings,
      ...newSettings
    };
    this.save();
    return this.data.settings;
  }

  verifyAdmin(username, password) {
    const creds = this.data.settings?.adminCredentials || DEFAULT_DB.settings.adminCredentials;
    return creds.username === username && creds.password === password;
  }

  clearAllUserData() {
    this.data.users = [];
    this.data.vehicles = [];
    this.data.orders = [];
    this.data.alerts = [];
    this.data.callLogs = [];
    this.save();
    return true;
  }

  // --- Call Logs ---
  getCallLogs(filters = {}) {
    let result = [...(this.data.callLogs || [])];
    if (filters.plate) {
      const p = filters.plate.toUpperCase().trim();
      result = result.filter(c => (c.vehiclePlate || '').toUpperCase().includes(p));
    }
    if (filters.type) {
      result = result.filter(c => c.type === filters.type);
    }
    return result;
  }

  addCallLog(call = {}) {
    if (!this.data.callLogs) this.data.callLogs = [];
    const newCall = {
      id: call.id || `call-${Date.now()}`,
      type: call.type || 'INCOMING',
      callerTitle: call.callerTitle || 'Bystander (Near Vehicle)',
      callerSub: call.callerSub || 'SafeQR IVR Relay',
      phoneMasked: call.phoneMasked || '+91 98*** *****',
      vehiclePlate: (call.vehiclePlate || '').toUpperCase().trim(),
      timestamp: call.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timeAgo: call.timeAgo || 'Just now',
      duration: call.duration || (call.type === 'MISSED' ? undefined : '38s'),
      status: call.status || (call.type === 'MISSED' ? 'MISSED' : 'COMPLETED')
    };
    this.data.callLogs.unshift(newCall);
    this.save();
    return newCall;
  }

  // --- Vehicles ---
  getAllVehicles(filters = {}) {
    let result = [...(this.data.vehicles || [])];

    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      result = result.filter(v => 
        (v.registrationPlate && v.registrationPlate.toLowerCase().includes(q)) ||
        (v.ownerName && v.ownerName.toLowerCase().includes(q)) ||
        (v.ownerPhone && v.ownerPhone.includes(q)) ||
        (v.city && v.city.toLowerCase().includes(q)) ||
        (v.orderId && v.orderId.toLowerCase().includes(q)) ||
        (v.activationKey && v.activationKey.toLowerCase().includes(q))
      );
    }

    if (filters.country && filters.country !== 'ALL') {
      result = result.filter(v => v.country && v.country.toLowerCase() === filters.country.toLowerCase());
    }

    if (filters.state && filters.state !== 'ALL') {
      result = result.filter(v => v.state && v.state.toLowerCase() === filters.state.toLowerCase());
    }

    if (filters.bloodGroup && filters.bloodGroup !== 'ALL') {
      result = result.filter(v => v.medical && v.medical.bloodGroup && v.medical.bloodGroup.includes(filters.bloodGroup));
    }

    if (filters.status && filters.status !== 'ALL') {
      result = result.filter(v => v.guardStatus === filters.status);
    }

    return result;
  }

  getVehicleById(id) {
    return this.data.vehicles.find(v => v.id === id);
  }

  getVehicleByToken(token) {
    const cleanToken = token.trim();
    return this.data.vehicles.find(v => 
      v.qrToken === cleanToken || 
      v.registrationPlate.replace(/[^A-Za-z0-9]/g, '') === cleanToken.replace(/[^A-Za-z0-9]/g, '') ||
      `VID-${v.registrationPlate.replace(/[^A-Za-z0-9]/g, '')}` === cleanToken
    );
  }

  getVehicleByActivationKey(activationKey) {
    if (!activationKey) return null;
    const cleanKey = activationKey.trim().toUpperCase();
    const found = this.data.vehicles.find(v => 
      v.activationKey && v.activationKey.trim().toUpperCase() === cleanKey
    );
    return found || null;
  }

  createVehicle(vehicleData) {
    const plate = vehicleData.registrationPlate ? vehicleData.registrationPlate.toUpperCase().trim() : 'UNKNOWN';
    const cleanPlate = plate.replace(/[^A-Z0-9]/gi, '');
    const id = vehicleData.id || `veh-${Date.now()}`;
    const qrToken = vehicleData.qrToken || `VID-${cleanPlate}`;
    const activationKey = vehicleData.activationKey || `SQR-KEY-${Math.floor(1000 + Math.random() * 9000)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Get default responders for country
    const countryResponders = this.data.settings?.countryResponders?.[vehicleData.country] || { police: '112', ambulance: '108' };

    const newVehicle = {
      id,
      orderId: vehicleData.orderId || `ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      activationKey,
      qrToken,
      registrationPlate: plate,
      model: vehicleData.model || 'Standard Vehicle',
      vehicleType: vehicleData.vehicleType || 'Car',
      ownerName: vehicleData.ownerName || 'Vehicle Owner',
      ownerPhone: vehicleData.ownerPhone || '',
      ownerEmail: vehicleData.ownerEmail || '',
      address: vehicleData.address || '',
      city: vehicleData.city || '',
      state: vehicleData.state || '',
      country: vehicleData.country || 'India',
      guardStatus: vehicleData.guardStatus || 'GUARD_ACTIVE',
      medical: {
        bloodGroup: vehicleData.medical?.bloodGroup || 'Not Specified',
        allergies: Array.isArray(vehicleData.medical?.allergies) ? vehicleData.medical.allergies : (vehicleData.medical?.allergies ? [vehicleData.medical.allergies] : ['None']),
        insurancePolicyId: vehicleData.medical?.insurancePolicyId || '',
        emergencyNote: vehicleData.medical?.emergencyNote || ''
      },
      emergencyContacts: Array.isArray(vehicleData.emergencyContacts) ? vehicleData.emergencyContacts : [],
      emergencyResponders: vehicleData.emergencyResponders || countryResponders,
      createdAt: vehicleData.createdAt || new Date().toLocaleString(),
      paidAmount: vehicleData.paidAmount || 299
    };

    this.data.vehicles.unshift(newVehicle);
    this.save();
    return newVehicle;
  }

  updateVehicle(id, updates) {
    const index = this.data.vehicles.findIndex(v => v.id === id);
    if (index === -1) return null;

    const existing = this.data.vehicles[index];

    // If country changed and responders not explicitly overridden, update responders
    let emergencyResponders = updates.emergencyResponders || existing.emergencyResponders;
    if (updates.country && updates.country !== existing.country && !updates.emergencyResponders) {
      const countryDefaults = this.data.settings?.countryResponders?.[updates.country];
      if (countryDefaults) {
        emergencyResponders = { police: countryDefaults.police, ambulance: countryDefaults.ambulance };
      }
    }

    const updated = {
      ...existing,
      ...updates,
      medical: {
        ...existing.medical,
        ...(updates.medical || {})
      },
      emergencyResponders,
      id: existing.id // preserve ID
    };

    this.data.vehicles[index] = updated;
    this.save();
    return updated;
  }

  deleteVehicle(id) {
    const initialLen = this.data.vehicles.length;
    this.data.vehicles = this.data.vehicles.filter(v => v.id !== id);
    const deleted = this.data.vehicles.length < initialLen;
    if (deleted) this.save();
    return deleted;
  }

  // --- Users & Authentication ---
  getAllUsers() {
    return this.data.users || [];
  }

  getUserByPhone(phone) {
    if (!phone) return null;
    const clean = phone.toString().replace(/\D/g, '');
    const users = this.data.users || [];
    return users.find(u => (u.phone || '').toString().replace(/\D/g, '') === clean) || null;
  }

  createOrUpdateUser(userData) {
    if (!this.data.users) this.data.users = [];
    if (!userData.phone) throw new Error('Phone number is required.');
    const cleanPhone = userData.phone.toString().replace(/\D/g, '');
    const idx = this.data.users.findIndex(u => (u.phone || '').toString().replace(/\D/g, '') === cleanPhone);

    const resolvedName = userData.name || userData.fullName || (idx >= 0 ? this.data.users[idx].name : 'SafeQR User');
    const existingMedical = idx >= 0 ? (this.data.users[idx].medical || {}) : { bloodGroup: 'O+ Positive', allergies: ['None'] };
    const resolvedMedical = userData.medical ? { ...existingMedical, ...userData.medical } : {
      ...existingMedical,
      bloodGroup: userData.bloodGroup || existingMedical.bloodGroup || 'O+ Positive',
      allergies: userData.allergies ? (Array.isArray(userData.allergies) ? userData.allergies : [userData.allergies]) : (existingMedical.allergies || ['None'])
    };

    const userRecord = {
      id: userData.id || (idx >= 0 ? this.data.users[idx].id : `usr-${cleanPhone}`),
      phone: cleanPhone,
      name: resolvedName,
      email: userData.email || (idx >= 0 ? this.data.users[idx].email : ''),
      pincode: userData.pincode || (idx >= 0 ? this.data.users[idx].pincode : ''),
      state: userData.state || (idx >= 0 ? this.data.users[idx].state : 'Madhya Pradesh'),
      city: userData.city || (idx >= 0 ? this.data.users[idx].city : 'Satna'),
      address: userData.address || (idx >= 0 ? this.data.users[idx].address : ''),
      medical: resolvedMedical,
      emergencyContacts: userData.emergencyContacts || (idx >= 0 ? this.data.users[idx].emergencyContacts : []),
      updatedAt: new Date().toISOString()
    };

    if (idx >= 0) {
      this.data.users[idx] = { ...this.data.users[idx], ...userRecord };
      this.save();
      return this.data.users[idx];
    } else {
      userRecord.createdAt = new Date().toISOString();
      userRecord.status = 'ACTIVE';
      userRecord.freeCallsRemaining = this.data.config?.pricing?.freeCallsAllowance || 3;
      this.data.users.unshift(userRecord);
      this.save();
      return userRecord;
    }
  }

  updateUserStatus(phone, status) {
    if (!this.data.users) this.data.users = [];
    const clean = phone.toString().replace(/\D/g, '');
    const user = this.data.users.find(u => (u.phone || '').toString().replace(/\D/g, '') === clean);
    if (!user) return null;
    user.status = status; // 'ACTIVE' | 'SUSPENDED'
    user.updatedAt = new Date().toISOString();
    this.save();
    return user;
  }

  resetUserCalls(phone, count) {
    if (!this.data.users) this.data.users = [];
    const clean = phone.toString().replace(/\D/g, '');
    const user = this.data.users.find(u => (u.phone || '').toString().replace(/\D/g, '') === clean);
    if (!user) return null;
    user.freeCallsRemaining = count !== undefined ? Number(count) : (this.data.config?.pricing?.freeCallsAllowance || 3);
    user.updatedAt = new Date().toISOString();
    this.save();
    return user;
  }

  setOtp(phone, otp) {
    if (!this.data.otps) this.data.otps = {};
    const clean = phone.toString().replace(/\D/g, '');
    this.data.otps[clean] = {
      otp: otp.toString(),
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 mins
    };
    this.save();
    return true;
  }

  verifyOtp(phone, otp) {
    if (!phone || !otp) return false;
    const clean = phone.toString().replace(/\D/g, '');
    const cleanOtp = otp.toString().trim();
    if (cleanOtp === '1056') return true; // Master demo OTP for fast testing

    if (!this.data.otps || !this.data.otps[clean]) return false;
    const record = this.data.otps[clean];
    if (Date.now() > record.expiresAt) return false;
    return record.otp === cleanOtp;
  }

  // --- Orders ---
  getAllOrders(filters = {}) {
    let orders = this.data.orders || [];
    if (filters.phone) {
      const cleanPhone = filters.phone.toString().replace(/\D/g, '');
      orders = orders.filter(o => (o.ownerPhone || '').toString().replace(/\D/g, '') === cleanPhone);
    }
    return orders;
  }

  createOrder(orderData) {
    const orderId = orderData.orderId || orderData.id || `ORD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newOrder = {
      id: orderId,
      orderId,
      vehiclePlate: orderData.vehiclePlate || 'MH-12-DE-9900',
      ownerName: orderData.ownerName || 'Vehicle Owner',
      ownerEmail: orderData.ownerEmail || '',
      ownerPhone: (orderData.ownerPhone || orderData.phone || '').toString().replace(/\D/g, ''),
      plan: orderData.plan || orderData.packName || 'Digital + Decal Safety Pack',
      amount: orderData.amount || 299,
      currency: orderData.currency || 'INR',
      status: orderData.status || 'PAID',
      deliveryStatus: orderData.deliveryStatus || 'PROCESSING',
      trackingId: orderData.trackingId || `TRK-IN-${Math.floor(10000 + Math.random() * 90000)}`,
      activationKey: orderData.activationKey || '',
      createdAt: orderData.createdAt || new Date().toLocaleString()
    };

    if (!this.data.orders) this.data.orders = [];
    this.data.orders.unshift(newOrder);
    this.save();
    return newOrder;
  }

  updateOrderStatus(orderId, status, deliveryStatus) {
    const order = (this.data.orders || []).find(o => o.orderId === orderId || o.id === orderId);
    if (!order) return null;
    if (status) order.status = status;
    if (deliveryStatus) order.deliveryStatus = deliveryStatus;
    this.save();
    return order;
  }

  // --- Incidents ---
  getAllIncidents(filters = {}) {
    let list = this.data.incidents || [];
    if (filters.vehicleId) {
      list = list.filter(i => i.vehicleId === filters.vehicleId);
    }
    if (filters.plate) {
      const cleanPlate = filters.plate.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
      list = list.filter(i => 
        (i.registrationPlate || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase() === cleanPlate
      );
    }
    return list;
  }

  addIncident(incident) {
    if (!this.data.incidents) this.data.incidents = [];
    this.data.incidents.unshift(incident);
    this.save();
    return incident;
  }

  updateIncident(id, updates) {
    const inc = (this.data.incidents || []).find(i => i.id === id);
    if (!inc) return null;
    Object.assign(inc, updates);
    this.save();
    return inc;
  }
}

const db = new SafeQRDatabase();
module.exports = db;
