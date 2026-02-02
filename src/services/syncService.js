const akiaService = require("./akiaService");
const hubspotService = require("./hubspotService");
const config = require("../config/env");

const HS = config.HUBSPOT.PIPELINE_CONFIG;

const getAkiaData = async (dealData) => {
  const akiaGuest = await akiaService.send("/v3/customers", {
    first_name: dealData.guestInfo.firstName,
    last_name: dealData.guestInfo.lastName,
    email: dealData.guestInfo.emailAddress,
    phone_number: dealData.guestInfo.phoneNumber,
    extern_id: dealData.guestInfo.guestProfID,
    property_id: 1387,
  });

  if (!akiaGuest?.id) return { akiaGuest: null, reservation: null };

  const reservation = await akiaService.send("/v4/reservations", {
    customer_id: akiaGuest.id,
    arrival_date: dealData.stayInfo.arrivalDate,
    departure_date: dealData.stayInfo.departureDate,
    extern_id: dealData.confirmationNumber,
    room_type: dealData.offers?.villaType,
  });

  return { akiaGuest, reservation };
};

const getAkiaDataViaSearch = async (dealData) => {
  const params = new URLSearchParams({
    office_id: 1387,
    extern_id: dealData.confirmationNumber,
    confirmation_number: dealData.confirmationNumber,
  });

  return await akiaService.send(`/v4/reservations/search?${params}`);
};

exports.upsertReservation = async (dealData) => {
  try {
    const numberOfNights = Number(dealData.offers.nights) || 1;
    const allLineItems = [];
    const salesReps = { salesRepAgId: dealData.salesRepAgId };

    const arrival = new Date(dealData.stayInfo.arrivalDate);

    for (let i = 0; i < numberOfNights; i++) {
      const currentNightDate = new Date(arrival);
      currentNightDate.setDate(arrival.getDate() + i);
      const formattedDate = currentNightDate.toISOString().split("T")[0];

      allLineItems.push({
        ...salesReps,
        dealItemName: `Night ${i + 1} - ${formattedDate}`,
        itemType: "night",
        villaType: dealData.offers.villaType,
        price: dealData.offers.price,
        dateOfNight: formattedDate,
        depositPolicy: dealData.cxlPolicy,
      });
    }

    const addOns = (dealData?.addOnItems || []).map((item) => ({
      ...salesReps,
      dealItemName: "Add-on",
      itemType: "addon",
      price: item.price,
      taxAmount: item.taxAmount,
      postType: item.postType,
      depositPolicy: item.depositPolicy,
    }));

    const spaItems = (dealData?.spaItems || []).map((item) => ({
      ...salesReps,
      dealItemName: "Spa Appointment",
      itemType: "spa",
      spaService: item?.activityDetail?.activityName,
      price: item.price,
      gratuityAmount: item.gratuityAmount,
      therapistId: item.therapistId,
      assignedRoom: item.assignedRoom,
      depositPolicy: item.depositPolicy,
    }));

    allLineItems.push(...addOns, ...spaItems);

    // A. Akia sync
    let akiaLink = null;
    try {
      const { akiaGuest } = await getAkiaData(dealData);

      if (akiaGuest?.id) {
        akiaLink = `https://sys.akia.com/inbox/${akiaGuest.id}`;
      }
    } catch (akiaErr) {
      console.error("Akia Sync Warning:", akiaErr.message);
    }

    // B. Hubspot sync
    const dealPayload = {
      confirmationNumber: dealData.confirmationNumber,
      arrivalDate: dealData.stayInfo.arrivalDate,
      departureDate: dealData.stayInfo.departureDate,
      villaType: dealData.offers.villaType,
      villaNumber: dealData.offers.villaNumber,
      origin: dealData.origin,
      segment: dealData.segment,
      depositSchedule: dealData.depositSchedule,
      cxlPolicy: dealData.cxlPolicy,
      guestType: dealData.guestType,
      lastName: dealData.guestInfo.lastName,
      dealStage: "closedwon",
      items: allLineItems,
    };

    const extraUpdates = {
      [HS.prop_akia_url]: akiaLink,
    };

    await hubspotService.pushDeal(dealPayload, extraUpdates);
  } catch (err) {
    console.error(
      `Sync Service Failed for ${dealData?.confirmationNumber}:`,
      err.message,
    );
    throw err;
  }
};

exports.updateStatus = async (dealData, status, stage) => {
  try {
    // A. Akia sync
    try {
      const reservation = await getAkiaDataViaSearch(dealData);

      if (reservation?.id) {
        await akiaService.send(`/v4/reservations/${reservation.id}`, {
          status: status,
        });
      }
    } catch (e) {
      console.warn("Akia Cancel Warning:", e.message);
    }

    // B. Hubspot sync
    await hubspotService.updateDealStatus(dealData.confirmationNumber, stage);
  } catch (err) {
    console.error(
      `Cancellation Failed for ${dealData?.confirmationNumber || "Unknown"}:`,
      err.message,
    );
  }
};
