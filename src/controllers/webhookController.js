const syncService = require("../services/syncService");
const agilysysService = require("../services/agilysysService");

const mapper = (resData) => {
  const data = resData;

  const guest = data.guestInfo || {};

  const offers = data.offers || {};

  const stay = data.stayInfo || {};

  return {
    confirmationNumber: data.confirmationNumber,
    status: data.status,
    origin: data.origin,
    segment: data.segment,
    depositSchedule: data.depositSchedule,
    cxlPolicy: data.cxlPolicy,
    guestType: data.guestType,

    guestInfo: {
      firstName: guest.firstName,
      lastName: guest.lastName,
      emailAddress: guest.emailAddress || "",
      phoneNumber: guest.cellNumber || guest.phoneNumber || "",
      guestProfID: guest.guestProfID || "",
    },

    stayInfo: {
      arrivalDate: stay.arrivalDate,
      departureDate: stay.departureDate,
      adults: stay?.guestCounts?.adults || 1,
      children: stay?.guestCounts?.children || 0,
    },

    offers: {
      villaType: offers.roomType,
      villaNumber: offers.roomNum,
      price: offers.price, // Tentative, Duetto
    },
  };
};

exports.webhook = async (req, res) => {
  try {
    const event = req.body;

    const confirmationNumber = event.confirmationNumber;

    if (!confirmationNumber) {
      return res.status(200).send("No confirmation ID available");
    }

    const reservationData = await agilysysService.getReservation(
      confirmationNumber,
      event.guestInfo.lastName,
    );

    if (!reservationData) {
      console.error(
        `FETCH FAILED: Could not retrieve details for ${confirmationNumber}`,
      );
      return res.status(200).send("Fetch Failed");
    }

    const dealItemData = await agilysysService.getFolio(confirmationNumber);

    const trimmedReservationData = mapper(reservationData);

    const mergedData = {
      ...trimmedReservationData,
      dealItems: dealItemData,
    };

    let eventType = event.eventType;

    switch (eventType) {
      case "NewReservation":
      case "ModifyReservation":
        await syncService.upsertReservation(mergedData);
        break;
      case "CheckedInReservation":
        await syncService.updateStatus(mergedData, "arrived", "1270278403");
        break;
      case "CheckedOutReservation":
        await syncService.updateStatus(mergedData, "departed", "1270278404");
        break;
      case "CancelReservation":
        await syncService.updateStatus(mergedData, "canceled", "closedlost");
        break;
      default:
        if (mergedData.status === "canceled") {
          await syncService.updateStatus(mergedData, "canceled", "closedlost");
        } else {
          await syncService.upsertReservation(mergedData);
        }
        break;
    }
    res.status(200).json({ success: true, id: confirmationNumber });
  } catch (err) {
    console.error("WEBHOOK ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
};
