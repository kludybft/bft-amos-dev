const syncService = require("../services/syncService");
const agilysysService = require("../services/agilysysService");

const mapper = (resData, webhookData) => {
  const guest = resData.guestInfo || {};
  const offers = resData.offers || {};
  const stay = resData.stayInfo || {};

  return {
    confirmationNumber: resData.confirmationNumber ?? null,
    status: resData.status ?? null,
    origin: resData.origin ?? null,
    segment: resData.segment ?? null,
    depositSchedule: resData.depositSchedule ?? null,
    cxlPolicy: resData.cxlPolicy ?? null,
    guestType: resData.guestType ?? null,

    firstName: guest.firstName ?? null,
    lastName: guest.lastName ?? null,
    emailAddress: guest.emailAddress ?? null,
    phoneNumber: guest.cellNumber || guest.phoneNumber || null,
    guestProfID: guest.guestProfID ?? null,

    arrivalDate: stay.arrivalDate ?? null,
    departureDate: stay.departureDate ?? null,
    adults: stay?.guestCounts?.adults ?? null,
    children: stay?.guestCounts?.children ?? null,

    villaType: offers.roomType ?? null,
    villaNumber: offers.roomNum ?? null,
    price: offers.price ?? null,
    nights: offers.nights ?? null,
  };
};

exports.webhook = async (req, res) => {
  try {
    const event = req.body;

    const confirmationNumber =
      event.data.referenceIds.find((r) => r.idType === "CONFIRMATION_NUMBER")
        ?.id ?? null;

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

    const trimmedReservationData = mapper(reservationData, event.data);

    const dealItemData = await agilysysService.getFolio(confirmationNumber);

    const mergedData = {
      ...trimmedReservationData,
      dealItems: dealItemData,
    };

    let eventType = event.eventType;

    const STAGE_IDS = {
      ARRIVED: "1270278403",
      DEPARTED: "1270278404",
      CLOSED_LOST: "closedlost",
    };

    switch (eventType) {
      case "NewReservation":
      case "ModifyReservation":
        await syncService.upsertReservation(mergedData);
        break;
      case "CheckedInReservation":
        await syncService.updateStatus(
          mergedData,
          "arrived",
          STAGE_IDS.ARRIVED,
        );
        break;
      case "CheckedOutReservation":
        await syncService.updateStatus(
          mergedData,
          "departed",
          STAGE_IDS.DEPARTED,
        );
        break;
      case "CancelReservation":
        await syncService.updateStatus(
          mergedData,
          "canceled",
          STAGE_IDS.CLOSED_LOST,
        );
        break;
      default:
        console.warn(
          `Unhandled event type: ${eventType}, status: ${mergedData.status}`,
        );
        if (mergedData.status === "canceled") {
          await syncService.updateStatus(
            mergedData,
            "canceled",
            STAGE_IDS.CLOSED_LOST,
          );
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
