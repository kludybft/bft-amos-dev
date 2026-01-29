const akiaService = require("./akiaService");
const hubspotService = require("./hubspotService");
const config = require("../config/env");

const HS = config.HUBSPOT.PIPELINE_CONFIG;

// 1. Sync reservation
exports.syncReservation = async (dealData) => {
  try {
    // A. Generate line items
    const arrival = new Date(dealData.stayInfo.arrivalDate);
    const departure = new Date(dealData.stayInfo.departureDate);

    // Calculate number of nights
    const diffTime = Math.abs(departure - arrival);
    const numberOfNights = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

    const allLineItems = [];

    const salesReps = {
      // salesRepHsId: "12345678",
      salesRepAgId: dealData.salesRepAgId,
    };

    // Loop for Nightly Items
    for (let i = 0; i < numberOfNights; i++) {
      const currentNightDate = new Date(arrival);
      currentNightDate.setDate(arrival.getDate() + i);
      const formattedDate = currentNightDate.toISOString().split("T")[0];

      allLineItems.push({
        ...salesReps,
        confirmationNumber: dealData.confirmationNumber,
        dealItemName: `Night ${i + 1} - ${formattedDate}`,
        itemType: "night",
        dateOfNight: formattedDate,
        villaType: dealData.villaType,
      });
    }

    const addOns = (dealData?.addOnItems || []).map((item) => ({
      ...salesReps,
      confirmationNumber: item.confirmationNumber,
      dealItemName: "Add-on",
      itemType: "addon",
      price: item.price,
      taxAmount: item.taxAmount,
      postType: item.postType,
    }));

    const spaItems = (dealData?.spaItems || []).map((item) => ({
      ...salesReps,
      confirmationNumber: item?.activityDetail?.confirmationNumber,
      dealItemName: "Spa Appointment",
      itemType: "spa",
      spaService: item?.activityDetail?.activityName,
      price: item.price,
      gratuityAmount: item.gratuityAmount,
      taxAmount: item.taxAmount,
      therapistId: item.therapistId,
    }));

    allLineItems.push(...addOns, ...spaItems);

    // B. Akia sync
    let akiaLink = null;
    try {
      // 1. Create/Update Customer
      const akiaGuest = await akiaService.send("/v3/customers", {
        first_name: dealData.guestInfo.firstName,
        last_name: dealData.guestInfo.lastName,
        email: dealData.guestInfo.emailAddress,
        phone_number: dealData.guestInfo.phoneNumber,
        extern_id: dealData.guestInfo.guestProfID,
        property_id: 1387,
      });

      // 2. Create/Update Reservation
      if (akiaGuest?.id) {
        await akiaService.send("/v4/reservations", {
          customer_id: akiaGuest.id,
          arrival_date: dealData.stayInfo.arrivalDate,
          departure_date: dealData.stayInfo.departureDate,
          extern_id: dealData.confirmationNumber,
          room_type: dealData.villaType,
        });
        akiaLink = `https://sys.akia.com/inbox/${akiaGuest.id}`;
      }
    } catch (akiaErr) {
      console.error("Akia Sync Warning:", akiaErr.message);
    }

    // C. Hubspot sync
    const dealPayload = {
      confirmationNumber: dealData.confirmationNumber,
      arrivalDate: dealData.stayInfo.arrivalDate,
      departureDate: dealData.stayInfo.departureDate,
      villaType: dealData.villaType,
      villaNumber: dealData.villaNumber,
      lastName: dealData.guestInfo.lastName,
      dealStage: "closedwon",

      // line items ex. Spas, Add-ons
      items: allLineItems,
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

// 2. Handle cancellation
exports.handleCancellation = async (dealData) => {
  try {
    // A. Akia cancellation
    try {
      await akiaService.send("/v4/reservations", {
        extern_id: dealData.confirmationNumber,
        status: "cancelled",
      });
      console.log("Akia status updated to cancelled");
    } catch (e) {
      console.warn("Akia Cancel Warning:", e.message);
    }

    // B. Hubspot cancellation
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
