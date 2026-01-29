// const syncService = require("../services/syncService");
// const agilysysService = require("../services/agilysysService");

// // 1. ID FINDER
// // Finds the ID no matter where Agilysys hides it in the webhook
// const findConfirmationId = (data) => {
//   // Check Root
//   if (data.confirmationId) return data.confirmationId;
//   if (data.confirmationNumber) return data.confirmationNumber;

//   // Check content wrapper
//   if (data.content) {
//     if (data.content.confirmationId) return data.content.confirmationId;
//     if (data.content.confirmationNumber) return data.content.confirmationNumber;
//   }

//   // Check payload wrapper
//   if (data.payload) {
//     if (data.payload.confirmationId) return data.payload.confirmationId;
//     if (data.payload.confirmationNumber) return data.payload.confirmationNumber;
//   }

//   return null;
// };

// // 2. DATA MAPPER
// // Transforms the API response to match format
// const mapAgilysysResponse = (apiResponse) => {
//   const data = apiResponse;

//   // Guest Object
//   const guest = data.guestInfo || {};

//   // Offers Object
//   const offers = data.offers || {};

//   // Stay Object
//   const stay = data.stayInfo || {};

//   return {
//     confirmationNumber: data.confirmationId,
//     reservationID: data.reservationID,
//     status: data.status,
//     depositSchedule: data.createDate,
//     villaType: offers.roomType,
//     villaNumber: offers.roomNum,

//     guestInfo: {
//       firstName: guest.firstName || "Test",
//       lastName: guest.lastName || "Guest",
//       emailAddress: guest.emailAddress,
//       phoneNumber: guest.CellNumber || guest.PhoneNumber,
//       guestProfID: guest.guestProfID,
//       addressLine1: guest.addressLine1,
//       addressLine2: guest.addressLine2,
//       cityName: guest.cityName,
//       stateProvinceCode: guest.stateProvinceCode,
//       postalCode: guest.postalCode,
//       countryCode: guest.countryCode,
//     },

//     stayInfo: {
//       arrivalDate: stay?.arrivalDate,
//       departureDate: stay?.departureDate,
//       adults: stay?.guestCounts?.adults || 1,
//       children: stay?.guestCounts?.children || 0,
//     },
//   };
// };

// 3. MAIN HANDLER
exports.webhook = async (req, res) => {
  try {
    const events = req.body;

    // 1. JSON.stringify ensures you see the full "Envelope" AND "Data"
    // 'null, 2' formats it with indentation so it is easy to read in logs
    console.log('--- RAW WEBHOOK PAYLOAD ---');
    console.log(JSON.stringify(events, null, 2));
    console.log('---------------------------');

    // 2. Respond to Agilysys immediately so they know you received it
    res.status(200).send('Webhook received');

  } catch (error) {
    console.error('Error processing webhook:', error);
    // Even if your logic fails, you might still want to return 200 
    // to stop them from retrying, depending on your strategy.
    res.status(500).send('Server Error');
  }
  // try {
  //   const event = req.body;

  //   // Hunt for the ID
  //   const confirmationId = findConfirmationId(event);

  //   if (!confirmationId) {
  //     console.warn("SKIPPED: Webhook received but no Confirmation ID found.");
  //     return res.status(200).send("Skipped - No ID");
  //   }

  //   // Get full reservation data
  //   const fullReservationData = await agilysysService.getReservation(
  //     confirmationId,
  //     event.guestInfo.lastName,
  //   );

  //   if (!fullReservationData) {
  //     console.error(
  //       `FETCH FAILED: Could not retrieve details for ${confirmationId}`,
  //     );
  //     // Return 200 to prevent infinite retries
  //     return res.status(200).send("Fetch Failed");
  //   }

  //   // Get spa items
  //   // const spaData = await agilysysService.getSpaAppointment(confirmationId);

  //   const mergedData = {
  //     ...fullReservationData,
  //     // spaItems: spaData,
  //   };

  //   // Map the clean data
  //   const cleanData = mapAgilysysResponse(mergedData);

  //   // Determine action based on event type OR status
  //   let eventType = event.eventType;
  //   if (!eventType) {
  //     if (cleanData.status === "Canceled") eventType = "RESERVATION_CANCELLED";
  //     else eventType = "RESERVATION_UPDATED";
  //   }

  //   switch (eventType) {
  //     case "RESERVATION_CREATED":
  //     case "RESERVATION_UPDATED":
  //     case "CHECK_IN":
  //       await syncService.syncReservation(cleanData);
  //       break;

  //     case "RESERVATION_CANCELLED":
  //       await syncService.handleCancellation(cleanData);
  //       break;

  //     default:
  //       if (cleanData.status === "Canceled") {
  //         await syncService.handleCancellation(cleanData);
  //       } else {
  //         await syncService.syncReservation(cleanData);
  //       }
  //       break;
  //   }

  //   res.status(200).json({ success: true, id: confirmationId });
  // } catch (err) {
  //   console.error("WEBHOOK ERROR:", err.message);
  //   res.status(500).json({ error: err.message });
  // }
};
