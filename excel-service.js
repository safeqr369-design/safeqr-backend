const XLSX = require('xlsx');

/**
 * Excel Import & Export Engine for SafeQR
 * Handles bi-directional serialization between SafeQR Vehicle models and Excel (.xlsx / .csv)
 */

function exportVehiclesToWorkbook(vehicles = []) {
  const rows = vehicles.map((v, index) => {
    const c1 = v.emergencyContacts?.[0] || {};
    const c2 = v.emergencyContacts?.[1] || {};
    const allergiesStr = Array.isArray(v.medical?.allergies) 
      ? v.medical.allergies.join(', ') 
      : (v.medical?.allergies || 'None');

    return {
      'S.No': index + 1,
      'Order ID': v.orderId || '',
      'Activation Key': v.activationKey || '',
      'QR Token': v.qrToken || '',
      'Registration Plate': v.registrationPlate || '',
      'Vehicle Model': v.model || '',
      'Vehicle Type': v.vehicleType || 'Car',
      'Owner Name': v.ownerName || '',
      'Owner Mobile': v.ownerPhone || '',
      'Owner Email': v.ownerEmail || '',
      'Shipping Address': v.address || '',
      'City': v.city || '',
      'State': v.state || '',
      'Country': v.country || 'India',
      'Blood Group': v.medical?.bloodGroup || 'Not Specified',
      'Medical Allergies': allergiesStr,
      'Emergency Note': v.medical?.emergencyNote || '',
      'Emergency Contact 1 (Name)': c1.name || '',
      'Contact 1 Relationship': c1.relationship || '',
      'Contact 1 Phone': c1.phone || '',
      'Emergency Contact 2 (Name)': c2.name || '',
      'Contact 2 Relationship': c2.relationship || '',
      'Contact 2 Phone': c2.phone || '',
      'Police Emergency Number': v.emergencyResponders?.police || '112',
      'Ambulance Emergency Number': v.emergencyResponders?.ambulance || '108',
      'Safety Guard Status': v.guardStatus || 'GUARD_ACTIVE',
      'Registered Date': v.createdAt || ''
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Set column widths for readability in Excel
  const colWidths = [
    { wch: 6 },  // S.No
    { wch: 15 }, // Order ID
    { wch: 22 }, // Activation Key
    { wch: 18 }, // QR Token
    { wch: 18 }, // Plate
    { wch: 25 }, // Model
    { wch: 12 }, // Type
    { wch: 20 }, // Owner Name
    { wch: 16 }, // Mobile
    { wch: 24 }, // Email
    { wch: 28 }, // Address
    { wch: 14 }, // City
    { wch: 16 }, // State
    { wch: 14 }, // Country
    { wch: 14 }, // Blood Group
    { wch: 20 }, // Allergies
    { wch: 25 }, // Note
    { wch: 20 }, // C1 Name
    { wch: 16 }, // C1 Rel
    { wch: 16 }, // C1 Phone
    { wch: 20 }, // C2 Name
    { wch: 16 }, // C2 Rel
    { wch: 16 }, // C2 Phone
    { wch: 12 }, // Police
    { wch: 14 }, // Ambulance
    { wch: 16 }, // Guard Status
    { wch: 20 }  // Date
  ];
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'SafeQR_Vehicles');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function parseVehiclesFromWorkbook(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel workbook contains no sheets.');
  }

  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  if (rawRows.length === 0) {
    throw new Error('The uploaded Excel sheet contains no rows.');
  }

  const parsedVehicles = [];

  rawRows.forEach((row, idx) => {
    // Flexible column resolution (case-insensitive & trimmed)
    const findVal = (...keys) => {
      for (const k of keys) {
        for (const rowKey of Object.keys(row)) {
          if (rowKey.trim().toLowerCase() === k.trim().toLowerCase()) {
            return String(row[rowKey]).trim();
          }
        }
      }
      return '';
    };

    const plate = findVal('Registration Plate', 'Plate', 'Vehicle Number', 'Car Number', 'Plate Number');
    if (!plate) {
      // Skip rows with empty plate
      return;
    }

    const ownerName = findVal('Owner Name', 'Name', 'Customer Name') || 'Vehicle Owner';
    const ownerPhone = findVal('Owner Mobile', 'Mobile', 'Phone', 'Owner Phone');
    const ownerEmail = findVal('Owner Email', 'Email');
    const model = findVal('Vehicle Model', 'Model', 'Car Model') || 'Standard Vehicle';
    const vehicleType = findVal('Vehicle Type', 'Type') || 'Car';
    const country = findVal('Country') || 'India';
    const state = findVal('State', 'Province');
    const city = findVal('City');
    const address = findVal('Shipping Address', 'Address');
    const bloodGroup = findVal('Blood Group', 'Blood') || 'Not Specified';
    const allergiesRaw = findVal('Medical Allergies', 'Allergies');
    const emergencyNote = findVal('Emergency Note', 'Medical Note', 'Notes');

    // Contacts
    const c1Name = findVal('Emergency Contact 1 (Name)', 'Contact 1 Name', 'Emergency Contact 1');
    const c1Rel = findVal('Contact 1 Relationship', 'Contact 1 Rel') || 'Family';
    const c1Phone = findVal('Contact 1 Phone', 'Contact 1 Mobile');

    const c2Name = findVal('Emergency Contact 2 (Name)', 'Contact 2 Name', 'Emergency Contact 2');
    const c2Rel = findVal('Contact 2 Relationship', 'Contact 2 Rel') || 'Family';
    const c2Phone = findVal('Contact 2 Phone', 'Contact 2 Mobile');

    const contacts = [];
    if (c1Name && c1Phone) {
      contacts.push({ id: `ec-imp-${idx}-1`, name: c1Name, relationship: c1Rel, phone: c1Phone, priority: 1 });
    }
    if (c2Name && c2Phone) {
      contacts.push({ id: `ec-imp-${idx}-2`, name: c2Name, relationship: c2Rel, phone: c2Phone, priority: 2 });
    }

    // Emergency Responders
    const police = findVal('Police Emergency Number', 'Police') || '';
    const ambulance = findVal('Ambulance Emergency Number', 'Ambulance') || '';

    parsedVehicles.push({
      registrationPlate: plate,
      model,
      vehicleType,
      ownerName,
      ownerPhone,
      ownerEmail,
      address,
      city,
      state,
      country,
      guardStatus: findVal('Safety Guard Status', 'Status') || 'GUARD_ACTIVE',
      medical: {
        bloodGroup,
        allergies: allergiesRaw ? allergiesRaw.split(',').map(s => s.trim()) : ['None'],
        emergencyNote
      },
      emergencyContacts: contacts,
      emergencyResponders: (police && ambulance) ? { police, ambulance } : undefined
    });
  });

  return parsedVehicles;
}

function generateSampleTemplate() {
  const sampleData = [
    {
      'Registration Plate': 'DL-01-AB-1234',
      'Vehicle Model': 'Hyundai Creta SX',
      'Vehicle Type': 'SUV',
      'Owner Name': 'Sameer Verma',
      'Owner Mobile': '+919811223344',
      'Owner Email': 'sameer.verma@example.com',
      'Shipping Address': 'B-42 Defence Colony',
      'City': 'New Delhi',
      'State': 'Delhi',
      'Country': 'India',
      'Blood Group': 'B+ Positive',
      'Medical Allergies': 'None',
      'Emergency Note': 'Contact spouse first in accident.',
      'Emergency Contact 1 (Name)': 'Priya Verma',
      'Contact 1 Relationship': 'Spouse',
      'Contact 1 Phone': '+919811223345',
      'Emergency Contact 2 (Name)': 'Rajesh Verma',
      'Contact 2 Relationship': 'Brother',
      'Contact 2 Phone': '+919811223346',
      'Police Emergency Number': '112',
      'Ambulance Emergency Number': '108',
      'Safety Guard Status': 'GUARD_ACTIVE'
    },
    {
      'Registration Plate': 'MH-02-CD-5678',
      'Vehicle Model': 'Honda City ZX',
      'Vehicle Type': 'Car',
      'Owner Name': 'Aditi Rao',
      'Owner Mobile': '+919822334455',
      'Owner Email': 'aditi.rao@example.com',
      'Shipping Address': 'Flat 702 Oberoi Towers, Goregaon',
      'City': 'Mumbai',
      'State': 'Maharashtra',
      'Country': 'India',
      'Blood Group': 'O+ Positive',
      'Medical Allergies': 'Penicillin',
      'Emergency Note': 'Carries emergency inhaler.',
      'Emergency Contact 1 (Name)': 'Karan Rao',
      'Contact 1 Relationship': 'Spouse',
      'Contact 1 Phone': '+919822334456',
      'Emergency Contact 2 (Name)': 'Sunita Sharma',
      'Contact 2 Relationship': 'Parent',
      'Contact 2 Phone': '+919822334457',
      'Police Emergency Number': '112',
      'Ambulance Emergency Number': '108',
      'Safety Guard Status': 'GUARD_ACTIVE'
    }
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'SafeQR_Sample_Template');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  exportVehiclesToWorkbook,
  parseVehiclesFromWorkbook,
  generateSampleTemplate
};
