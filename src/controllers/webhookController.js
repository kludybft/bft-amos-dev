const syncService = require("../services/syncService");
const agilysysService = require("../services/agilysysService");

const mapAgilysysResponse = (apiResponse) => {
  const data = apiResponse;

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
      phoneNumber: guest.CellNumber || guest.PhoneNumber || "",
      guestProfID: guest.guestProfID || "",
      addressLine1: guest.addressLine1 || "",
      addressLine2: guest.addressLine2 || "",
      cityName: guest.cityName || "",
      stateProvinceCode: guest.stateProvinceCode || "",
      postalCode: guest.postalCode || "",
      countryCode: guest.countryCode || "",
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
      console.warn("SKIPPED: Webhook received but no Confirmation ID found.");
      return res.status(200).send("Skipped - No ID");
    }

    const fullReservationData =
      event ||
      (await agilysysService.getReservation(
        confirmationNumber,
        event.guestInfo.lastName,
      ));

    if (!fullReservationData) {
      console.error(
        `FETCH FAILED: Could not retrieve details for ${confirmationNumber}`,
      );
      return res.status(200).send("Fetch Failed");
    }

    // const spaData = await agilysysService.getSpaAppointment(confirmationNumber);

    const mergedData = {
      ...fullReservationData,
      // spaItems: spaData,
    };

    const cleanData = mapAgilysysResponse(mergedData);

    let eventType = event.eventType;

    if (!eventType) {
      if (cleanData.status === "canceled") eventType = "CancelReservation";
      else eventType = "ModifyReservation";
    }

    switch (eventType) {
      case "NewReservation":
      case "ModifyReservation":
        await syncService.upsertReservation(cleanData);
        break;

      case "CheckedInReservation":
        await syncService.updateStatus(cleanData, "arrived", "1270278403");
        break;
      case "CheckedOutReservation":
        await syncService.updateStatus(cleanData, "departed", "1270278404");
        break;
      case "CancelReservation":
        await syncService.updateStatus(cleanData, "canceled", "closedlost");
        break;

      default:
        if (cleanData.status === "canceled") {
          await syncService.updateStatus(cleanData);
        } else {
          await syncService.upsertReservation(cleanData);
        }
        break;
    }

    res.status(200).json({ success: true, id: confirmationNumber });
  } catch (err) {
    console.error("WEBHOOK ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
};
