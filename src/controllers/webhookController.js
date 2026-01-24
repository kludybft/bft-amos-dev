const syncService = require("../services/syncService");
const agilysysService = require("../services/agilysysService");

// --- 1. ID FINDER ---
// Finds the ID no matter where Agilysys hides it in the webhook
const findConfirmationId = (data) => {
  // Check Root
  if (data.confirmationId) return data.confirmationId;
  if (data.confirmationNumber) return data.confirmationNumber;

  // Check 'content' wrapper
  if (data.content) {
    if (data.content.confirmationId) return data.content.confirmationId;
    if (data.content.confirmationNumber) return data.content.confirmationNumber;
  }

  // Check 'payload' wrapper
  if (data.payload) {
    if (data.payload.confirmationId) return data.payload.confirmationId;
    if (data.payload.confirmationNumber) return data.payload.confirmationNumber;
  }

  return null;
};

// --- 2. DATA MAPPER (For the API Response) ---
// Transforms the "Fat" API response into your App's clean format
const mapAgilysysResponse = (apiResponse) => {
  const data = apiResponse;

  // Handle Guest Array (Primary or First)
  const guests = Array.isArray(data.guestInfo) ? data.guestInfo : [];
  const primaryGuest =
    guests.find((g) => g.primaryGuest === "true") || guests[0] || {};

  // Handle Offers Array (Room Type)
  const primaryOffer =
    data.offers && data.offers.length > 0 ? data.offers[0] : {};

  return {
    confirmationNumber: data.confirmationId,
    status: data.status,
    depositSchedule: data.createDate,
    villaType: primaryOffer.roomType,
    villaNumber: primaryOffer.roomNum,
    reservationID: data.reservationID,

    guestInfo: {
      firstName: primaryGuest.firstName || "Test",
      lastName: primaryGuest.lastName || "Guest",
      emailAddress: primaryGuest.emailAddress,
      phoneNumber: primaryGuest.CellNumber || primaryGuest.PhoneNumber,
      guestProfID: primaryGuest.guestProfID,
      address: {
        city: primaryGuest.cityName,
        state: primaryGuest.stateProvinceCode,
        country: primaryGuest.countryCode,
      },
    },

    stayInfo: {
      arrivalDate: data.stayInfo?.arrivalDate,
      departureDate: data.stayInfo?.departureDate,
      adults: data.stayInfo?.guestCounts?.adults || 1,
      children: data.stayInfo?.guestCounts?.discChild || 0,
    },
  };
};

// --- 3. MAIN HANDLER ---
exports.webhook = async (req, res) => {
  try {
    const event = req.body;

    // Step A: Log Raw Payload (For Debugging)
    console.log("RAW WEBHOOK:", JSON.stringify(event, null, 2));

    // Step B: Hunt for the ID
    const confirmationId = findConfirmationId(event);

    if (!confirmationId) {
      console.warn("SKIPPED: Webhook received but no Confirmation ID found.");
      return res.status(200).send("Skipped - No ID");
    }

    console.log(
      `Found ID: ${confirmationId}. Fetching full details from API...`,
    );

    // Step C: The "Fetch-Back" (Get the Perfect Data)
    const fullReservationData =
      await agilysysService.getReservation(confirmationId);

    if (!fullReservationData) {
      console.error(
        `FETCH FAILED: Could not retrieve details for ${confirmationId}`,
      );
      // We return 200 to prevent infinite retries from Agilysys
      return res.status(200).send("Fetch Failed");
    }

    const spaData = await agilysysService.getSpaAppointment(confirmationId);

    const mergedData = {
      ...fullReservationData,
      spaItems: spaData,
    };

    // Step D: Map the Perfect Data
    const cleanData = mapAgilysysResponse(mergedData);

    // Step E: Determine Action based on Event Type OR Status
    // Priority: Explicit Event Type -> Infer from Status
    let eventType = event.eventType;
    if (!eventType) {
      if (cleanData.status === "Canceled") eventType = "RESERVATION_CANCELLED";
      else eventType = "RESERVATION_UPDATED";
    }

    console.log(
      `🚀 Processing ${eventType} for ${cleanData.confirmationNumber}`,
    );

    switch (eventType) {
      case "RESERVATION_CREATED":
      case "RESERVATION_UPDATED":
      case "CHECK_IN":
        await syncService.syncReservation(cleanData);
        break;

      case "RESERVATION_CANCELLED":
        await syncService.handleCancellation(cleanData);
        break;

      default:
        if (cleanData.status === "Canceled") {
          await syncService.handleCancellation(cleanData);
        } else {
          await syncService.syncReservation(cleanData);
        }
        break;
    }

    res.status(200).json({ success: true, id: confirmationId });
  } catch (err) {
    console.error("WEBHOOK ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
};
