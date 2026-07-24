import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import BiometricDevice from "@/models/BiometricDevice";
import User from "@/models/User";
import Attendance from "@/models/Attendance";
import PunchLog from "@/models/PunchLog";

export async function GET(req: NextRequest) {
  console.log("ZKTeco ADMS GET Init:", req.url);
  return new NextResponse(
    "GET OPTION FROM: " + req.nextUrl.searchParams.get("SN") + "\n" +
    "Stamp=9999\n" +
    "OpStamp=9999\n" +
    "ErrorDelay=60\n" +
    "Delay=30\n" +
    "TransTimes=00:00;14:00\n" +
    "TransInterval=1\n" +
    "TransFlag=1111000000\n" +
    "TimeZone=1\n" +
    "Realtime=1\n" +
    "Encrypt=0",
    { status: 200 }
  );
}

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const sn = req.nextUrl.searchParams.get("SN");
    if (!sn) {
      return new NextResponse("UNKNOWN DEVICE", { status: 400 });
    }

    // 2. Parse raw body
    const textBody = await req.text();
    console.log(`ZKTeco push from ${sn}:\n${textBody}`);

    // 1. Find device
    const device = await BiometricDevice.findOne({ serialNumber: sn });
    if (!device) {
      console.warn(`ZKTeco push from unknown device: ${sn}`);
      return new NextResponse("OK", { status: 200 }); // Still return OK to avoid retry loops on unconfigured devices
    }

    // Update lastSeen and lastLog
    device.lastSeen = new Date();
    device.lastLog = textBody.substring(0, 500); // store first 500 chars for debugging
    await device.save();
    // Format is typically: USER_PIN\tDATE_TIME\tSTATUS\tVERIFY_MODE\t...
    const lines = textBody.split("\n").filter((l) => l.trim().length > 0);

    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length >= 2) {
        const employeeId = parts[0].trim();
        const dateTimeStr = parts[1].trim(); // "YYYY-MM-DD HH:mm:ss"
        const punchStatusStr = parts.length >= 3 ? parts[2].trim() : "255";
        const punchStatus = isNaN(parseInt(punchStatusStr, 10)) ? 255 : parseInt(punchStatusStr, 10);
        
        const verifyModeStr = parts.length >= 4 ? parts[3].trim() : "20";
        const verifyMode = isNaN(parseInt(verifyModeStr, 10)) ? 20 : parseInt(verifyModeStr, 10);
        
        // Find user
        const user = await User.findOne({ 
          pharmacyId: device.pharmacyId, 
          employeeId: employeeId 
        });

        if (user) {
          const [datePart, timePart] = dateTimeStr.split(" ");
          
          if (datePart && timePart) {
            const dateStr = datePart; // YYYY-MM-DD
            // The ZKTeco device is in Nigeria (UTC+1). 
            // If we use 'Z', the server thinks it's UTC and the browser adds 1 hour.
            // Using '+01:00' tells the server the exact local time of the punch.
            const recordTime = new Date(`${datePart}T${timePart}+01:00`); 
            
            // Immediately log the raw punch
            await PunchLog.create({
              pharmacyId: device.pharmacyId,
              branchId: device.branchId,
              userId: user._id,
              deviceSerialNumber: device.serialNumber,
              punchTime: recordTime,
              punchStatus: punchStatus,
              verifyMode: verifyMode
            });
            
            const existingAttendance = await Attendance.findOne({
              pharmacyId: device.pharmacyId,
              userId: user._id,
              date: dateStr
            });

            if (existingAttendance) {
               if (punchStatus === 0) {
                 // CHECK-IN (F1 or Check-In button pressed)
                 // Only update if for some reason the new punch is EARLIER than existing clockIn.
                 // Prevents "time theft" by double-punching later in the day.
                 if (!existingAttendance.clockInTime || recordTime < existingAttendance.clockInTime) {
                     existingAttendance.clockInTime = recordTime;
                     await existingAttendance.save();
                 }
               } else if (punchStatus === 1) {
                 // CHECK-OUT (F2 or Check-Out button pressed)
                 // Always push the clockOut time forward
                 if (!existingAttendance.clockOutTime || recordTime > existingAttendance.clockOutTime) {
                     existingAttendance.clockOutTime = recordTime;
                     await existingAttendance.save();
                 }
               } else {
                 // 255 (Auto) or Legacy fallback: Just push clockOut time forward
                 if (!existingAttendance.clockOutTime || recordTime > existingAttendance.clockOutTime) {
                     existingAttendance.clockOutTime = recordTime;
                     await existingAttendance.save();
                 }
               }
            } else {
               // Create new attendance
               await Attendance.create({
                 pharmacyId: device.pharmacyId,
                 branchId: device.branchId,
                 userId: user._id,
                 date: dateStr,
                 clockInTime: punchStatus === 1 ? null : recordTime, // If they only checked-out, clockIn is null
                 clockOutTime: punchStatus === 1 ? recordTime : null, // If they checked-out, store in clockOut
                 status: "present",
                 clockInMethod: "face", // Assuming face or biometric
                 recordedBy: user._id 
               });
            }
          }
        }
      }
    }

    // Acknowledge receipt
    return new NextResponse("OK", { status: 200 });

  } catch (error) {
    console.error("Error processing ZKTeco data:", error);
    // Always return OK or the device will endlessly retry
    return new NextResponse("OK", { status: 200 }); 
  }
}
