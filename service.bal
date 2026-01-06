import ballerina/http;
import ballerina/log;
import ballerina/time;

// --- 1. CONFIGURATION ---
// These will appear in your Choreo "Configs" tab.
configurable string akiaApiKey = ?;
configurable string akiaBaseUrl = "https://api.akia.com/v1";

// --- 2. DATA DEFINITION ---
// This record captures EVERY field mentioned in your spreadsheet
type AgilysysEvent record {
    string event_type;         // INSERT, UPDATE, SCHEDULED_CHECK, KEY_ISSUED
    string? res_id;            // Reservation ID
    string? status;            // Current status
    string? old_status;        // Previous status (for checking changes)
    string? new_status;        // New status
    string? key_status;        // For Digital Keys (ISSUED, DELIVERED)
    
    // Guest Info
    string? guest_first;
    string? guest_last;
    string? email;
    string? phone_mobile;
    
    // Dates (Format: YYYY-MM-DD)
    string? arrival_date;
    string? departure_date;
    string? old_arrival_date;
    string? new_arrival_date;
    string? room_category;
};

// --- 3. THE BRIDGE SERVICE ---
service /agilysys on new http:Listener(9090) {

    http:Client akiaClient;

    function init() returns error? {
        // Initialize Akia connection securely
        self.akiaClient = check new (akiaBaseUrl, {
            auth: { token: akiaApiKey }
        });
    }

    resource function post webhook(@http:Payload AgilysysEvent payload) returns json|error {
        
        log:printInfo("Received Event: " + payload.event_type);

        // =================================================================
        // ROW 1: NEW RESERVATION CONFIRMATION
        // Logic: event_type = INSERT AND status is RESERVED or CONFIRMED
        // =================================================================
        if (payload.event_type == "INSERT") {
            string status = payload.status ?: "";
            if (status == "RESERVED" || status == "CONFIRMED") {
                return check self.syncReservationToAkia(payload);
            }
        }

        // =================================================================
        // ROW 4, 7, 8, 9, 10: STATUS CHANGES & MODIFICATIONS
        // Logic: event_type = UPDATE (CDC Update)
        // =================================================================
        if (payload.event_type == "UPDATE") {
            string newSt = payload.new_status ?: "";
            string oldSt = payload.old_status ?: "";

            // ROW 4: Successful Check-In
            if (oldSt == "RESERVED" && newSt == "CHECKED_IN") {
                return check self.updateAkiaStatus(payload.res_id, "checked_in");
            }

            // ROW 8: Checkout Survey
            if (oldSt == "CHECKED_IN" && newSt == "CHECKED_OUT") {
                return check self.updateAkiaStatus(payload.res_id, "checked_out");
            }

            // ROW 9: Cancellation
            if (newSt == "CANCELLED") {
                return check self.updateAkiaStatus(payload.res_id, "cancelled");
            }

            // ROW 10: Reservation Modification (Dates Changed)
            if (payload.new_arrival_date != payload.old_arrival_date) {
                // Re-sync the whole reservation to update dates
                return check self.syncReservationToAkia(payload);
            }
        }

        // =================================================================
        // ROW 5: DIGITAL KEY DELIVERY
        // Logic: event_type = KEY_ISSUED
        // =================================================================
        if (payload.event_type == "KEY_ISSUED") {
            string kStatus = payload.key_status ?: "";
            if (kStatus == "ISSUED" || kStatus == "DELIVERED") {
                // Trigger a specific event in Akia
                return check self.triggerCustomEvent(payload, "digital_key_delivery");
            }
        }

        // =================================================================
        // ROW 2, 3, 6, 7: SCHEDULED CHECKS (Date Logic)
        // Logic: event_type = SCHEDULED_CHECK (Assuming PMS sends daily checks)
        // =================================================================
        if (payload.event_type == "SCHEDULED_CHECK") {
            
            // Calculate "Today" and "Tomorrow"
            string today = time:utcToString(time:utcNow()).substring(0, 10); 
            // Note: For precise production date math, we usually use the 'time' module more deeply,
            // but string matching works if PMS sends ISO dates (YYYY-MM-DD).
            
            string arrival = payload.arrival_date ?: "";
            string departure = payload.departure_date ?: "";
            string status = payload.status ?: "";

            // ROW 2: Pre-Arrival Check-in (T-24h)
            // Logic: Arrival is Tomorrow
            if (status == "RESERVED" && self.isTomorrow(arrival)) { 
                return check self.triggerCustomEvent(payload, "pre_arrival_checkin");
            }

            // ROW 3: Day of Arrival Welcome
            // Logic: Arrival is Today
            if (status == "RESERVED" && arrival == today) {
                return check self.triggerCustomEvent(payload, "day_of_arrival_welcome");
            }

            // ROW 7: Departure Morning Info
            // Logic: Departure is Today
            if (status == "CHECKED_IN" && departure == today) {
                return check self.triggerCustomEvent(payload, "departure_morning");
            }
        }

        return { "status": "ignored", "reason": "No matching rule found" };
    }

    // --- HELPER 1: Sync Full Reservation (Creates or Updates) ---
    function syncReservationToAkia(AgilysysEvent event) returns json|error {
        json akiaPayload = {
            "external_id": event.res_id,
            "status": "reserved",
            "guest": {
                "first_name": event.guest_first,
                "last_name": event.guest_last,
                "email": event.email,
                "phone": event.phone_mobile
            },
            "stay": {
                "arrival_date": event.new_arrival_date ?: event.arrival_date,
                "departure_date": event.departure_date,
                "room_type": event.room_category
            }
        };
        http:Response resp = check self.akiaClient->post("/reservations", akiaPayload);
        log:printInfo("Synced Reservation: " + (event.res_id ?: "null"));
        return { "status": "synced", "code": resp.statusCode };
    }

    // --- HELPER 2: Update Status Only (Check-in/out) ---
    function updateAkiaStatus(string? resId, string newStatus) returns json|error {
        if (resId == null) { return error("Missing Reservation ID"); }
        
        json patchPayload = { "status": newStatus };
        string path = "/reservations/" + resId;
        
        http:Response resp = check self.akiaClient->patch(path, patchPayload);
        log:printInfo("Updated Status to " + newStatus);
        return { "status": "updated", "code": resp.statusCode };
    }

    // --- HELPER 3: Trigger Custom Event (For Keys & Scheduled items) ---
    function triggerCustomEvent(AgilysysEvent event, string eventName) returns json|error {
        json eventPayload = {
            "event_name": eventName,
            "guest": {
                "reservation_id": event.res_id,
                "phone": event.phone_mobile,
                "email": event.email
            }
        };
        http:Response resp = check self.akiaClient->post("/integrations/events", eventPayload);
        log:printInfo("Triggered Event: " + eventName);
        return { "status": "triggered", "event": eventName };
    }

    // --- HELPER 4: Date Math (Is date string tomorrow?) ---
    function isTomorrow(string dateStr) returns boolean {
        // Simple logic: Get current time, add 24 hours, compare strings
        time:Utc tomorrowUtc = time:utcAddSeconds(time:utcNow(), 86400);
        string tomorrowStr = time:utcToString(tomorrowUtc).substring(0, 10);
        return dateStr == tomorrowStr;
    }
}