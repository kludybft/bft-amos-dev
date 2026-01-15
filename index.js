const express = require("express");
const axios = require("axios");
const querystring = require("querystring");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
app.use(express.json());

// ==========================================
// 1. CONFIGURATION
// ==========================================
const AKIA_BASE_URL = "https://api.akia.com";
const CLIENT_ID = process.env.AKIA_CLIENT_ID;
const CLIENT_SECRET = process.env.AKIA_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI; // Your Choreo URL + /auth/callback
const MONGODB_URI = process.env.MONGODB_URI; // Connection string from Choreo/Atlas

// ==========================================
// 2. MONGODB SETUP (The Memory Bank)
// ==========================================
// Connect to Database
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// Define Schema: This is what our "Save File" looks like
const tokenSchema = new mongoose.Schema({
  _id: { type: String, default: "akia_auth" }, // Hardcoded ID to keep just ONE record
  access_token: String,
  refresh_token: String,
  expires_at: Number, // Timestamp
});

const TokenModel = mongoose.model("Token", tokenSchema);

// ==========================================
// 3. TOKEN HELPERS (Database Interaction)
// ==========================================

// Helper: Save (or Update) tokens in MongoDB
async function saveTokensToDB(data) {
  // Calculate expiration: Now + (ExpiresIn - 60 seconds buffer)
  const expiresInMs = (data.expires_in - 60) * 1000;
  const expirationTime = Date.now() + expiresInMs;

  // "upsert: true" means create if it doesn't exist, update if it does
  await TokenModel.findByIdAndUpdate(
    "akia_auth",
    {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expirationTime,
    },
    { upsert: true, new: true }
  );
  console.log("💾 Tokens saved to Database.");
}

// Helper: Get Token (and Auto-Refresh if needed)
async function getValidToken() {
  // 1. Retrieve from DB
  const tokenDoc = await TokenModel.findById("akia_auth");

  if (!tokenDoc || !tokenDoc.access_token) {
    throw new Error(
      "⚠️ No tokens found in DB. Please visit /auth/login to authenticate."
    );
  }

  // 2. Check Expiration
  if (Date.now() >= tokenDoc.expires_at) {
    console.log("⏰ Token expired. Performing rolling refresh...");

    try {
      // Exchange OLD refresh token for NEW pair
      const payload = querystring.stringify({
        refresh_token: tokenDoc.refresh_token,
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      });

      const response = await axios.post(
        `${AKIA_BASE_URL}/oauth/token`,
        payload,
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );

      // 3. Save NEW tokens to DB (Overwrite old ones)
      await saveTokensToDB(response.data);

      return response.data.access_token;
    } catch (error) {
      console.error(
        "❌ Refresh Failed:",
        error.response?.data || error.message
      );
      throw new Error("Refresh failed. You may need to log in again manually.");
    }
  }

  // 3. Token is still fresh
  return tokenDoc.access_token;
}

// ==========================================
// 4. OAUTH ROUTES (Login & Callback)
// ==========================================

// Step A: Admin Login Link
app.get("/auth/login", (req, res) => {
  // Updated scopes to include customers and reservations
  const scopes = "customers:read,customers:write,properties:read,properties:write"; 
  const authUrl =
    `https://sys.akia.com/oauth/authorize?` +
    `client_id=${CLIENT_ID}&` +
    `scope=${scopes}&` +
    `response_type=code&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  res.redirect(authUrl);
});

// Step B: Callback from Akia
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  console.log("🔹 Callback received. Code:", code ? "Present" : "Missing");

  if (!code) return res.status(400).send("No code returned.");

  try {
    console.log("🔹 Exchanging code for token...");

    // 1. Prepare Payload
    const payload = querystring.stringify({
      code: code,
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    // 2. Request Token from Akia
    const response = await axios.post(`${AKIA_BASE_URL}/oauth/token`, payload, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    console.log("✅ Token received from Akia.");

    // 3. Save to MongoDB
    console.log("🔹 Attempting to save to MongoDB...");
    await saveTokensToDB(response.data);
    console.log("✅ Tokens saved to Database.");

    res.send(
      "<h1>✅ Login Successful!</h1><p>Tokens secured in Database. You can close this.</p>"
    );
  } catch (error) {
    // CAPTURE THE REAL ERROR
    const errorData = error.response?.data || error.message;
    const errorStatus = error.response?.status || 500;

    console.error("❌ Auth Error Details:", JSON.stringify(errorData, null, 2));

    // Send the DETAILED error to the browser so you can see it
    res.status(errorStatus).send(`
      <h1>❌ Authentication Failed</h1>
      <p><b>Step Failed:</b> ${
        error.response ? "Akia Token Exchange" : "Database Save"
      }</p>
      <p><b>Error Code:</b> ${errorStatus}</p>
      <pre style="background: #f4f4f4; padding: 10px; border-radius: 5px;">
        ${JSON.stringify(errorData, null, 2)}
      </pre>
      <p>Check your Choreo Environment Variables.</p>
    `);
  }
});

// ==========================================
// 5. AKIA API CLIENT
// ==========================================
async function sendToAkia(endpoint, payload, method = "POST") {
  try {
    const token = await getValidToken(); // Gets fresh token from DB

    const response = await axios({
      method: method,
      url: `${AKIA_BASE_URL}/v1${endpoint}`,
      data: payload,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    console.log(`🚀 Success: ${method} ${endpoint} [${response.status}]`);
    return response.data;
  } catch (error) {
    // Handle "Not Logged In" errors specifically
    if (error.message.includes("No tokens found")) {
      console.error(
        "⛔ CRITICAL: App is not authenticated. Admin must visit /auth/login"
      );
    } else {
      console.error(
        `❌ API Error (${endpoint}): ${error.response?.status || error.message}`
      );
    }
    return null;
  }
}

// ==========================================
// 6. BUSINESS LOGIC (Webhooks)
// ==========================================

// Helper for sending Events to Akia
async function triggerAkiaEvent(eventName, resId) {
    console.log(`🔔 Triggering Event: ${eventName}`);
    await sendToAkia("/integrations/events", {
        event_name: eventName,
        guest: { reservation_id: resId }
    });
}

// Helper to check if date is tomorrow
function isTomorrow(dateString) {
    if (!dateString) return false;
    const today = new Date();
    const target = new Date(dateString);
    const diffTime = target - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    return diffDays === 1; 
}

app.post("/webhook", async (req, res) => {
  const data = req.body;
  console.log(`📨 Event: ${data.event_type} | Res ID: ${data.res_id}`);

  try {
    // ==================================================================
    // 1. NEW RESERVATION CONFIRMATION
    // Spreadsheet Row: 1
    // Logic: INSERT + RESERVED/CONFIRMED
    // ==================================================================
    if (
      data.event_type === "INSERT" &&
      (data.status === "RESERVED" || data.status === "CONFIRMED")
    ) {
      console.log("🔹 Processing New Reservation...");
      
      // Step A: Create/Find Customer
      const customerResponse = await sendToAkia("/v3/customers", {
        first_name: data.guest_first,
        last_name: data.guest_last,
        email: data.email,
        phone_number: data.phone_mobile,
      });

      if (!customerResponse?.id) throw new Error("Could not create Customer");

      // Step B: Create Reservation linked to Customer
      await sendToAkia("/v4/reservations", {
        customer_id: customerResponse.id,
        extern_id: data.res_id,
        arrival_date: data.arrival_date,
        departure_date: data.departure_date,
        room_type: data.room_category,
        status: "reserved",
        guest_count: 1
      });
      console.log("✅ New Reservation Synced");
    }

    // ==================================================================
    // 2. STATUS CHANGES (Check-In, Check-Out, Cancellation)
    // Spreadsheet Rows: 4, 8, 9
    // Logic: UPDATE event
    // ==================================================================
    if (data.event_type === "UPDATE") {
      const oldSt = data.old_status;
      const newSt = data.new_status;
      const endpoint = `/v4/reservations/${data.res_id}`; 

      // Row 4: Successful Check-In
      if (oldSt === "RESERVED" && newSt === "CHECKED_IN") {
        await sendToAkia(endpoint, { status: "checked_in" }, "PATCH");
        console.log("✅ Set status to Checked In");
      }

      // Row 8: Check-Out / Thanks & Survey
      if (oldSt === "CHECKED_IN" && newSt === "CHECKED_OUT") {
        await sendToAkia(endpoint, { status: "checked_out" }, "PATCH");
        console.log("✅ Set status to Checked Out");
      }

      // Row 9: Cancellation Acknowledgement
      if (newSt === "CANCELLED") {
        await sendToAkia(endpoint, { status: "cancelled" }, "PATCH");
        console.log("✅ Set status to Cancelled");
      }

      // Row 10: Reservation Modification (Dates or Room changed)
      if (
        data.new_arrival_date !== data.old_arrival_date ||
        data.new_room_type !== data.old_room_type
      ) {
        // Only run if the key fields actually exist in the update payload
        if (data.new_arrival_date) {
            await sendToAkia(endpoint, {
              arrival_date: data.new_arrival_date,
              departure_date: data.new_departure_date,
              room_type: data.new_room_type
            }, "PATCH");
            console.log("✅ Updated Reservation Details");
        }
      }
    }

    // ==================================================================
    // 3. DIGITAL KEYS
    // Spreadsheet Row: 5
    // ==================================================================
    if (
      data.event_type === "KEY_ISSUED" &&
      (data.key_status === "ISSUED" || data.key_status === "DELIVERED")
    ) {
      await triggerAkiaEvent("digital_key_delivery", data.res_id);
      console.log("✅ Digital Key Event Sent");
    }

    // ==================================================================
    // 4. SCHEDULED CHECKS (Pre-Arrival, Arrival, Departure, Mid-Stay)
    // Spreadsheet Rows: 2, 3, 6, 7
    // ==================================================================
    if (data.event_type === "SCHEDULED_CHECK" && data.status !== "CANCELLED") {
      
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const arrival = data.arrival_date;
      const departure = data.departure_date;

      // Row 2: Pre-Arrival (T-24h)
      if (isTomorrow(arrival)) {
        await triggerAkiaEvent("pre_arrival_checkin", data.res_id);
      }

      // Row 3: Day of Arrival Welcome
      if (arrival === today) {
        await triggerAkiaEvent("arrival_welcome", data.res_id);
      }

      // Row 7: Departure Morning Info
      if (departure === today && data.status === "CHECKED_IN") {
        await triggerAkiaEvent("departure_morning", data.res_id);
      }

      // Row 6: Mid-Stay "Everything OK?"
      if (today > arrival && today < departure && data.status === "CHECKED_IN") {
         await triggerAkiaEvent("mid_stay_check", data.res_id);
      }
    }

  } catch (error) {
    console.error("❌ Error processing webhook:", error.message);
    if (error.response) console.error(JSON.stringify(error.response.data, null, 2));
  }

  res.json({ status: "received" });
});

// START SERVER
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Bridge running on port ${PORT}`);
});