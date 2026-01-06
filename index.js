const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// 1. CONFIGURATION
const AKIA_API_KEY = process.env.AKIA_API_KEY;
const AKIA_BASE_URL = "https://api.akia.com/v1";

// 2. HELPER: Send Data to Akia
async function sendToAkia(endpoint, payload) {
    try {
        const response = await axios.post(`${AKIA_BASE_URL}${endpoint}`, payload, {
            headers: {
                'Authorization': `Bearer ${AKIA_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`Success: Sent to ${endpoint}`, response.status);
        return response.data;
    } catch (error) {
        console.error(`Error sending to Akia: ${error.response?.status || error.message}`);
        // We catch errors so the server doesn't crash
        return null;
    }
}

// 3. HELPER: Check if Date is Tomorrow (For Pre-Arrival)
function isTomorrow(dateStr) {
    if (!dateStr) return false;
    const today = new Date();
    const target = new Date(dateStr);
    const diffTime = target - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    return diffDays === 1; // Returns true if difference is 1 day
}

// 4. THE WEBHOOK LISTENER
app.post('/webhook', async (req, res) => {
    const data = req.body;
    console.log("Received Event:", data.event_type);

    // ==========================================
    // ROW 1: New Reservation
    // ==========================================
    if (data.event_type === 'INSERT' && (data.status === 'RESERVED' || data.status === 'CONFIRMED')) {
        const akiaPayload = {
            external_id: data.res_id,
            status: "reserved",
            guest: {
                first_name: data.guest_first,
                last_name: data.guest_last,
                email: data.email,
                phone: data.phone_mobile
            },
            stay: {
                arrival_date: data.arrival_date,
                departure_date: data.departure_date,
                room_type: data.room_category
            }
        };
        await sendToAkia('/reservations', akiaPayload);
    }

    // ==========================================
    // ROW 4, 7, 8: Status Changes
    // ==========================================
    if (data.event_type === 'UPDATE') {
        const oldSt = data.old_status;
        const newSt = data.new_status;

        // Check-In
        if (oldSt === 'RESERVED' && newSt === 'CHECKED_IN') {
            await axios.patch(`${AKIA_BASE_URL}/reservations/${data.res_id}`, { status: 'checked_in' }, {
                 headers: { 'Authorization': `Bearer ${AKIA_API_KEY}` }
            });
        }
        
        // Checkout
        if (oldSt === 'CHECKED_IN' && newSt === 'CHECKED_OUT') {
             await axios.patch(`${AKIA_BASE_URL}/reservations/${data.res_id}`, { status: 'checked_out' }, {
                 headers: { 'Authorization': `Bearer ${AKIA_API_KEY}` }
            });
        }
    }

    // ==========================================
    // ROW 5: Digital Key
    // ==========================================
    if (data.event_type === 'KEY_ISSUED' && (data.key_status === 'ISSUED' || data.key_status === 'DELIVERED')) {
        await sendToAkia('/integrations/events', {
            event_name: 'digital_key_delivery',
            guest: { reservation_id: data.res_id }
        });
    }

    // ==========================================
    // ROW 2: Pre-Arrival (Tomorrow)
    // ==========================================
    if (data.event_type === 'SCHEDULED_CHECK') {
        if (data.status === 'RESERVED' && isTomorrow(data.arrival_date)) {
            await sendToAkia('/integrations/events', {
                event_name: 'pre_arrival_checkin',
                guest: { reservation_id: data.res_id }
            });
        }
    }

    // Always respond 200 OK to Agilysys
    res.json({ status: "received" });
});

// START SERVER
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Bridge running on port ${PORT}`);
});