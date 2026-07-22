async function test() {
  const mainPsxUrl = 'https://www.psx.ng';
  const phone = '09000000001';
  const pass = 'password123';
  
  // Create staff
  const res = await fetch(`${mainPsxUrl}/api/staff`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer psx-internal-key-123'
    },
    body: JSON.stringify({
      name: 'Test Staff',
      role: 'staff',
      phoneNumber: phone,
      password: pass,
      pharmacyId: '6a498413f525e37baf907cc0', // Monak Pharmacy
      branchId: '6a498502e97d7c4031193acc',
      storeId: null
    })
  });
  
  const createData = await res.json();
  console.log('Create Response:', createData);
  
  // Login
  const loginRes = await fetch(`${mainPsxUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: phone, password: pass })
  });
  
  const loginData = await loginRes.json();
  console.log('Login Response:', JSON.stringify(loginData, null, 2));
}

test().catch(console.error);
