import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import BiometricDevice from "@/models/BiometricDevice";
import User from "@/models/User";
import Attendance from "@/models/Attendance";

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const sn = req.nextUrl.searchParams.get("SN");
    if (!sn) {
      return new NextResponse("UNKNOWN DEVICE", { status: 400 });
    }

    // 1. Find device
    const device = await BiometricDevice.findOne({ serialNumber: sn });
    if (!device) {
      console.warn(`ZKTeco push from unknown device: ${sn}`);
      return new NextResponse("OK", { status: 200 }); // Still return OK to avoid retry loops on unconfigured devices
    }

    // Update lastSeen
    device.lastSeen = new Date();
    await device.save();

    // 2. Parse raw body
    const textBody = await req.text();
    // Format is typically: USER_PIN\tDATE_TIME\tSTATUS\tVERIFY_MODE\t...
    const lines = textBody.split("\n").filter((l) => l.trim().length > 0);

    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length >= 2) {
        const employeeId = parts[0].trim();
        const dateTimeStr = parts[1].trim(); // "YYYY-MM-DD HH:mm:ss"
        
        // Find user
        const user = await User.findOne({ 
          pharmacyId: device.pharmacyId, 
          employeeId: employeeId 
        });

        if (user) {
          const [datePart, timePart] = dateTimeStr.split(" ");
          
          if (datePart && timePart) {
            const dateStr = datePart; // YYYY-MM-DD
            const recordTime = new Date(`${datePart}T${timePart}Z`); // Convert to Date
            
            const existingAttendance = await Attendance.findOne({
              pharmacyId: device.pharmacyId,
              userId: user._id,
              date: dateStr
            });

            if (existingAttendance) {
               // Update clockOutTime if this record is later than clockInTime
               if (!existingAttendance.clockOutTime || recordTime > existingAttendance.clockOutTime) {
                   existingAttendance.clockOutTime = recordTime;
                   await existingAttendance.save();
               }
            } else {
               // Create new attendance
               await Attendance.create({
                 pharmacyId: device.pharmacyId,
                 branchId: device.branchId,
                 userId: user._id,
                 date: dateStr,
                 clockInTime: recordTime,
                 status: "present",
                 clockInMethod: "face",
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
