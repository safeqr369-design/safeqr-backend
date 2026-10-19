# 🛡️ SafeQR Cloud Relay Server & Fleet Command Center

Official backend server, REST API, Server-Sent Events (SSE) dispatch engine, and Admin Management Portal for the **SafeQR** vehicle safety ecosystem.

---

## 🌟 Key Features

1. **⚡ Real-Time Bystander Portal (`/v/:plate` or `/v/:token`):**
   - Instant mobile web portal opened when a bystander scans any vehicle's SafeQR code.
   - 1-tap incident reporting: Car Blocked, Ambulance Path Blocked, Hazard Detected, Wrong Parking.
   - Emergency Medical Vault for first responders (Blood Group, Medical Notes, Emergency Family Contacts).
   - Real-time resolution status tracker showing vehicle owner response messages.

2. **🎛️ Admin Fleet & Orders Command Center (`/admin`):**
   - Real-time fleet metrics: Total Vehicles, Active QR Shields, Orders Count, Revenue.
   - Live Fleet Management: View, activate, standby, or suspend vehicle shields.
   - Orders & Dispatches: Track payments, update delivery status (PROCESSING, PRINTED, SHIPPED, DELIVERED).
   - Excel Bulk Import / Export (`.xlsx`) with automated data validation.
   - Dynamic System Settings: Custom toll-free numbers, OTP gateways, Payment Gateways (Razorpay, Cashfree, UPI).

3. **📡 Real-Time SSE Stream (`/api/incidents/stream`):**
   - 2-way event stream connecting mobile APKs and web portals with 0 polling.
   - Immediate notification dispatch to the vehicle owner when an incident is reported.

4. **🛍️ Public Marketing & Storefront (`/`):**
   - SafeQR public landing page with product decal showcases, features, and direct ordering.

---

## 🚀 Quick Start (Local Run)

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```

The server will automatically start on `http://localhost:3000` (or `PORT` specified in environment).

---

## ☁️ 1-Click Free Cloud Deployment (24/7 Running)

### Option 1: Deploy on Render.com (Recommended - Free)

1. Create a free account at [render.com](https://render.com).
2. Click **"New +"** -> **"Web Service"**.
3. Connect your GitHub repository (`safeqr-backend`).
4. Select the settings:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`
5. Click **"Create Web Service"**.
6. Render will assign you a live HTTPS URL (e.g. `https://safeqr-backend.onrender.com`).
   *Your server will now run 24/7 in the cloud without needing your laptop!*

---

### Option 2: Deploy on Railway.app

1. Sign up at [railway.app](https://railway.app).
2. Click **"New Project"** -> **"Deploy from GitHub repo"**.
3. Select your repository. Railway automatically detects `package.json` and starts the service.
4. Go to **Settings** -> **Generate Domain** to get your public HTTPS URL.

---

## 🔗 Environment Variables

| Variable | Description | Default |
|:---|:---|:---|
| `PORT` | Port number for Express server | `3000` |
| `PUBLIC_HOST` | Custom domain or public host (e.g. `api.safeqr.in`) | Auto-detected |
| `NODE_ENV` | Runtime environment (`production` / `development`) | `development` |

---

## 📡 API Endpoints Reference

| Endpoint | Method | Description |
|:---|:---|:---|
| `/` | `GET` | Public marketing landing & store page |
| `/admin` | `GET` | Master Admin Fleet & Orders Command Center |
| `/v/:token` | `GET` | Dynamic bystander QR scan portal |
| `/api/config` | `GET` | App configuration & dynamic server host sync |
| `/api/vehicles` | `GET`, `POST` | Vehicle fleet management |
| `/api/orders` | `GET`, `POST` | Store decal orders and dispatches |
| `/api/incidents` | `POST` | Bystander report parking/emergency incident |
| `/api/incidents/stream` | `GET` | Server-Sent Events (SSE) real-time stream |
| `/api/calls` | `GET`, `POST` | Call log history and masked IVR relay calls |
| `/api/admin/export/excel` | `GET` | Download complete fleet spreadsheet (`.xlsx`) |
| `/api/admin/import/excel` | `POST` | Bulk import vehicles via Excel spreadsheet |

---

© 2026 SafeQR Technologies India. All rights reserved.
