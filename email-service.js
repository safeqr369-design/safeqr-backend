const fs = require('fs');
const path = require('path');

const EMAILS_LOG_FILE = path.join(__dirname, 'data', 'sent_emails.json');

/**
 * Transactional Email Dispatcher for SafeQR
 * Generates responsive Daylight-styled HTML confirmation emails and records them.
 */

function ensureEmailLog() {
  const dir = path.dirname(EMAILS_LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sendActivationEmail(vehicle, order) {
  ensureEmailLog();

  const to = vehicle.ownerEmail || order?.ownerEmail || 'customer@example.com';
  const subject = `🛡️ SafeQR Activated: Your Vehicle Security Decal (${vehicle.registrationPlate})`;
  
  const contactsHtml = (vehicle.emergencyContacts || []).map((c, i) => 
    `<li style="margin-bottom: 4px;"><strong>#${i + 1} ${c.name}</strong> (${c.relationship}): <code>${c.phone}</code></li>`
  ).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>SafeQR Activation</title>
</head>
<body style="background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; color: #0F172A;">
  <div style="max-width: 600px; margin: 0 auto; background: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
    <!-- Brand Header -->
    <div style="background: #0F172A; padding: 28px 32px; text-align: center;">
      <div style="display: inline-block; background: #FFD600; color: #0F172A; font-weight: 900; font-size: 14px; padding: 6px 16px; border-radius: 6px; letter-spacing: 1px;">
        🛡️ SAFEQR PRIVACY RELAY
      </div>
      <h1 style="color: #FFFFFF; font-size: 22px; font-weight: 800; margin: 16px 0 4px 0;">Vehicle Safety Shield Activated</h1>
      <p style="color: #94A3B8; font-size: 13px; margin: 0;">Order #${order?.orderId || vehicle.orderId || 'ORD-2026'}</p>
    </div>

    <!-- Activation Key Highlight -->
    <div style="padding: 24px 32px; background: #F1F5F9; border-bottom: 1px solid #E2E8F0; text-align: center;">
      <div style="font-size: 11px; font-weight: 800; color: #64748B; letter-spacing: 1.5px; text-transform: uppercase;">Your Master Activation Key</div>
      <div style="font-size: 24px; font-weight: 900; color: #059669; font-family: monospace; letter-spacing: 2px; margin: 8px 0; background: #FFFFFF; display: inline-block; padding: 10px 24px; border-radius: 8px; border: 2px dashed #059669;">
        ${vehicle.activationKey}
      </div>
      <div style="font-size: 11px; color: #64748B; margin-top: 4px;">Keep this key confidential. Use it to link your vehicle in the SafeQR Mobile App.</div>
    </div>

    <!-- Vehicle & Owner Summary -->
    <div style="padding: 28px 32px;">
      <h3 style="font-size: 15px; font-weight: 800; color: #0F172A; border-bottom: 2px solid #F1F5F9; padding-bottom: 8px; margin-top: 0;">
        🚗 Registered Vehicle Details
      </h3>
      <table style="width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 20px;">
        <tr>
          <td style="padding: 8px 0; color: #64748B; width: 40%;">Registration Number:</td>
          <td style="padding: 8px 0; font-weight: 800; color: #0F172A;">${vehicle.registrationPlate}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748B;">Make & Model:</td>
          <td style="padding: 8px 0; font-weight: 700; color: #0F172A;">${vehicle.model} (${vehicle.vehicleType || 'Car'})</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748B;">Owner Name:</td>
          <td style="padding: 8px 0; font-weight: 700; color: #0F172A;">${vehicle.ownerName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748B;">Country & City:</td>
          <td style="padding: 8px 0; font-weight: 700; color: #0F172A;">${vehicle.city || 'City'}, ${vehicle.state || ''} (${vehicle.country || 'India'})</td>
        </tr>
      </table>

      <!-- Medical & Emergency Vault -->
      <div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 10px; padding: 16px; margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 800; color: #B45309; margin-bottom: 6px;">
          🚑 EMERGENCY ACCIDENT VAULT
        </div>
        <div style="font-size: 13px; color: #78350F; line-height: 20px;">
          • <strong>Blood Group:</strong> ${vehicle.medical?.bloodGroup || 'Not Specified'}<br/>
          • <strong>Allergies:</strong> ${Array.isArray(vehicle.medical?.allergies) ? vehicle.medical.allergies.join(', ') : 'None'}<br/>
          • <strong>Emergency Responders:</strong> Police: ${vehicle.emergencyResponders?.police || '112'} | Ambulance: ${vehicle.emergencyResponders?.ambulance || '108'}
        </div>
      </div>

      <!-- Linked Family Contacts -->
      <h4 style="font-size: 13px; font-weight: 800; color: #0F172A; margin-bottom: 8px;">
        👨‍👩‍👧 Linked Emergency Contacts:
      </h4>
      <ul style="font-size: 13px; color: #334155; padding-left: 20px; margin-top: 0; line-height: 22px;">
        ${contactsHtml || '<li>No emergency contacts linked. You can add them in the app.</li>'}
      </ul>

      <!-- CTA -->
      <div style="text-align: center; margin-top: 28px;">
        <a href="http://localhost:3000/v/${vehicle.qrToken}" style="background: #0F172A; color: #FFFFFF; font-weight: 800; font-size: 14px; text-decoration: none; padding: 14px 28px; border-radius: 8px; display: inline-block; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
          👁️ Preview Your Live QR Decal Portal
        </a>
      </div>

      <div style="margin-top: 24px; padding: 14px; background: #F8FAFC; border-radius: 8px; font-size: 11px; color: #64748B; text-align: center; line-height: 16px;">
        📦 <strong>Physical Decal Shipping:</strong> Your high-durability waterproof holographic QR windshield stickers are being printed and will be dispatched to your shipping address within 24-48 business hours.
      </div>
    </div>

    <!-- Footer -->
    <div style="background: #F1F5F9; padding: 16px 32px; text-align: center; font-size: 11px; color: #94A3B8; border-top: 1px solid #E2E8F0;">
      © 2026 SafeQR Technologies. Zero-exposure vehicle privacy and automated emergency response.
    </div>
  </div>
</body>
</html>`;

  const emailRecord = {
    id: `email-${Date.now()}`,
    orderId: order?.orderId || vehicle.orderId,
    vehiclePlate: vehicle.registrationPlate,
    to,
    subject,
    activationKey: vehicle.activationKey,
    sentAt: new Date().toLocaleString(),
    html
  };

  try {
    let list = [];
    if (fs.existsSync(EMAILS_LOG_FILE)) {
      list = JSON.parse(fs.readFileSync(EMAILS_LOG_FILE, 'utf8'));
    }
    list.unshift(emailRecord);
    if (list.length > 50) list = list.slice(0, 50); // keep recent 50
    fs.writeFileSync(EMAILS_LOG_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.error('[EMAIL] Failed to log sent email:', err.message);
  }

  console.log(`[EMAIL DISPATCHED] To: ${to} | Subject: "${subject}" | Key: ${vehicle.activationKey}`);
  return emailRecord;
}

function getEmailPreview(orderId) {
  try {
    if (fs.existsSync(EMAILS_LOG_FILE)) {
      const list = JSON.parse(fs.readFileSync(EMAILS_LOG_FILE, 'utf8'));
      const found = list.find(e => e.orderId === orderId || e.vehiclePlate === orderId);
      return found ? found.html : null;
    }
  } catch {}
  return null;
}

module.exports = {
  sendActivationEmail,
  getEmailPreview
};
