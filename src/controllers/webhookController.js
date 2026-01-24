const syncService = require("../services/syncService");
const agilysysService = require("../services/agilysysService");

// 1. ID FINDER
// Finds the ID no matter where Agilysys hides it in the webhook
const findConfirmationId = (data) => {
  // Check Root
  if (data.confirmationId) return data.confirmationId;
  if (data.confirmationNumber) return data.confirmationNumber;

  // Check content wrapper
  if (data.content) {
    if (data.content.confirmationId) return data.content.confirmationId;
    if (data.content.confirmationNumber) return data.content.confirmationNumber;
  }

  // Check payload wrapper
  if (data.payload) {
    if (data.payload.confirmationId) return data.payload.confirmationId;
    if (data.payload.confirmationNumber) return data.payload.confirmationNumber;
  }

  return null;
};

// 2. DATA MAPPER
// Transforms the API response to match format
const mapAgilysysResponse = (apiResponse) => {
  const data = apiResponse;

  // Guest Array
  const guests = Array.isArray(data.guestInfo) ? data.guestInfo : [];
  const primaryGuest =
    guests.find((g) => g.primaryGuest === "true") || guests[0] || {};

  // Offers Array
  const primaryOffer =
    data.offers && data.offers.length > 0 ? data.offers[0] : {};

  return {
    confirmationNumber: data.confirmationId,
    reservationID: data.reservationID,
    status: data.status,
    depositSchedule: data.createDate,
    villaType: primaryOffer.roomType,
    villaNumber: primaryOffer.roomNum,

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

// 3. MAIN HANDLER
exports.webhook = async (req, res) => {
  try {
    const event = req.body;

    // Hunt for the ID
    const confirmationId = findConfirmationId(event);

    if (!confirmationId) {
      console.warn("SKIPPED: Webhook received but no Confirmation ID found.");
      return res.status(200).send("Skipped - No ID");
    }

    // Get full reservation data
    const fullReservationData =
      await agilysysService.getReservation(confirmationId);

    if (!fullReservationData) {
      console.error(
        `FETCH FAILED: Could not retrieve details for ${confirmationId}`,
      );
      // Return 200 to prevent infinite retries
      return res.status(200).send("Fetch Failed");
    }

    const spaData = await agilysysService.getSpaAppointment(confirmationId);

    const mergedData = {
      ...fullReservationData,
      spaItems: spaData,
    };

    // Map the clean data
    const cleanData = mapAgilysysResponse(mergedData);

    // Determine action based on event type OR status
    let eventType = event.eventType;
    if (!eventType) {
      if (cleanData.status === "Canceled") eventType = "RESERVATION_CANCELLED";
      else eventType = "RESERVATION_UPDATED";
    }

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
