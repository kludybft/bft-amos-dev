const akiaService = require("./akiaService");
const hubspotService = require("./hubspotService");
const config = require("../config/env");

const HS = config.HUBSPOT.PIPELINE_CONFIG;

/**
 * 1. SYNC RESERVATION (Create or Update)
 * Handles mapping line items, syncing to Akia, and pushing to HubSpot.
 */
exports.syncReservation = async (dealData) => {
  try {
    // A. GENERATE LINE ITEMS
    const arrival = new Date(dealData.stayInfo.arrivalDate);
    const departure = new Date(dealData.stayInfo.departureDate);

    // Calculate number of nights
    const diffTime = Math.abs(departure - arrival);
    const numberOfNights = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

    const allLineItems = [];

    // Loop for Nightly Items
    for (let i = 0; i < numberOfNights; i++) {
      const currentNightDate = new Date(arrival);
      currentNightDate.setDate(arrival.getDate() + i);
      const formattedDate = currentNightDate.toISOString().split("T")[0];

      allLineItems.push({
        confirmationNumber: dealData.confirmationNumber,
        dealItemName: `Night ${i + 1} - ${formattedDate}`,
        itemType: "night",
        dateOfNight: formattedDate,
        villaType: dealData.villaType,
        salesRepHsId: "12345678",
        salesRepAgId: "AGUSER-9876",
      });
    }

    const addOns = (dealData.addOnItems || []).map((addOnItem) => ({
      //   dealItemName: "Add-on",
      //   itemType: "addon",
      //   price: addOnItem.price,
      //   taxAmount: addOnItem.taxAmount || null,
      //   postType: addOnItem.postType || null,
      //   salesRepHsId: "12345678",
      //   salesRepAgId: "AGUSER-9876",
    }));

    const spaItems = (dealData.spaItems || []).map((spaItem) => ({
      confirmationNumber: spaItem.activityDetail.confirmationNumber,
      dealItemName: "Spa Appointment",
      itemType: "spa",
      spaService: spaItem.activityDetail.activityName,
      //   startDateTime: spaItem.activityDetail.startDateTime,
      //   endDateTime: spaItem.activityDetail.endDateTime,
      price: spaItem.price,
      gratuityAmount: spaItem.gratuityAmount,
      taxAmount: spaItem.taxAmount,
      therapistId: spaItem.therapistId,
      salesRepHsId: "12345678",
      salesRepAgId: "AGUSER-9876",
    }));

    allLineItems.push(...addOns, ...spaItems);

    // B. AKIA SYNC
    let akiaLink = null;
    try {
      // 1. Create/Update Customer
      const akiaGuest = await akiaService.send("/v3/customers", {
        first_name: dealData.guestInfo.firstName,
        last_name: dealData.guestInfo.lastName,
        email: dealData.guestInfo.emailAddress,
        phone_number: dealData.guestInfo.phoneNumber,
        extern_id: dealData.guestInfo.guestProfID,
        property_id: 190,
      });

      // 2. Create/Update Reservation
      if (akiaGuest?.id) {
        await akiaService.send("/v4/reservations", {
          customer_id: akiaGuest.id,
          arrival_date: dealData.stayInfo.arrivalDate,
          departure_date: dealData.stayInfo.departureDate,
          extern_id: dealData.confirmationNumber,
          room_type: dealData.villaType,
          confirmation_number: dealData.confirmationNumber,
          status: "confirmed",
        });
        akiaLink = `https://app.akia.com/conversation/${akiaGuest.id}`;
      }
    } catch (akiaErr) {
      console.error("Akia Sync Warning:", akiaErr.message);
    }

    // C. HUBSPOT SYNC
    const dealPayload = {
      confirmationNumber: dealData.confirmationNumber,
      arrivalDate: dealData.stayInfo.arrivalDate,
      departureDate: dealData.stayInfo.departureDate,
      villaType: dealData.villaType,
      villaNumber: dealData.villaNumber,
      lastName: dealData.guestInfo.lastName,
      items: allLineItems,
      dealStage: "closedwon",
    };

    const extraUpdates = {
      [HS.prop_akia_url]: akiaLink,
    };

    await hubspotService.pushDeal(dealPayload, extraUpdates);

    console.log(`Sync Complete for Ref: ${dealData.confirmationNumber}`);
  } catch (err) {
    console.error(
      `Sync Service Failed for ${dealData.confirmationNumber}:`,
      err.message,
    );
    throw err;
  }
};

/**
 * 2. HANDLE CANCELLATION
 * Updates Akia status to 'cancelled' and moves HubSpot deal to 'Closed Lost'
 */
exports.handleCancellation = async (dealData) => {
  try {
    // A. AKIA CANCELLATION
    // We try to update the reservation status.
    // Note: Verify if your akiaService.send supports method overrides (PUT/PATCH).
    // If not, standard POST often acts as an upsert if extern_id matches.
    try {
      await akiaService.send("/v4/reservations", {
        extern_id: dealData.confirmationNumber,
        status: "cancelled",
      });
      console.log("Akia status updated to cancelled");
    } catch (e) {
      console.warn("Akia Cancel Warning:", e.message);
    }

    // B. HUBSPOT CANCELLATION
    // We specifically move the deal stage to "Closed Lost"
    // Make sure you implemented 'updateDealStatus' in your hubspotService!
    await hubspotService.updateDealStatus(
      dealData.confirmationNumber,
      "closedlost",
    );
    console.log("HubSpot deal moved to Closed Lost");
  } catch (err) {
    console.error(
      `Cancellation Failed for ${dealData.confirmationNumber}:`,
      err.message,
    );
  }
};
