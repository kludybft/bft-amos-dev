const akiaService = require("../services/akiaService");
const hubspotService = require("../services/hubspotService");
const agilysysService = require("../services/agilysysService");
const config = require("../config/env");

const HS = config.HUBSPOT.PIPELINE_CONFIG;

exports.handleWebhook = async (req, res) => {
  const hookData = req.body;
  const confirmationNumber = hookData.confirmationNumber;
  const eventType = hookData.event_type || hookData.eventType || "UNKNOWN";

  console.log(`Webhook: ${eventType} | ID: ${confirmationNumber}`);

  if (!confirmationNumber) return res.status(200).send("No ID found");

  try {
    let fullData = hookData;
    // Fetch full data if missing guest info (unless it's a key event)
    if (!hookData.guestInfo && !eventType.includes("KEY")) {
      fullData = await agilysysService.fetchDetails(confirmationNumber);
      if (!fullData) return res.status(200).send("Fetch Failed");
    }

    const reservation = {
      res_id: fullData.reservationID || confirmationNumber,
      status: fullData.status,
      guest_first: fullData.guestInfo?.firstName || "Guest",
      guest_last: fullData.guestInfo?.lastName || "Unknown",
      email: fullData.guestInfo?.email,
      phone: fullData.guestInfo?.mobilePhone || fullData.guestInfo?.phone,
      arrival: fullData.stayInfo?.arrivalDate,
      departure: fullData.stayInfo?.departureDate,
      room: fullData.stayInfo?.roomType,
      price: fullData.stayInfo?.totalAmount || fullData.depositAmount,
    };

    // --- LOGIC ROUTER ---

    // 1. NEW RESERVATION
    if (
      eventType.includes("CREATED") ||
      reservation.status === "RESERVED" ||
      reservation.status === "CONFIRMED"
    ) {
      console.log(`New Reservation: ${reservation.guest_last}`);

      const akiaGuest = await akiaService.send("/v3/customers", {
        first_name: reservation.guest_first,
        last_name: reservation.guest_last,
        email: reservation.email,
        phone_number: reservation.phone,
      });

      if (akiaGuest?.id) {
        await akiaService.send("/v4/reservations", {
          customer_id: akiaGuest.id,
          extern_id: reservation.res_id,
          arrival_date: reservation.arrival,
          departure_date: reservation.departure,
          room_type: reservation.room,
          status: "reserved",
          guest_count: 1,
        });

        const akiaLink = `https://app.akia.com/conversation/${akiaGuest.id}`;

        await hubspotService.pushDeal(reservation, {
          [HS.prop_akia_url]: akiaLink,
          [HS.prop_status]: reservation.status,
        });
      }
    }

    // 2. UPDATES (Check-in/out/Cancel)
    else if (
      eventType.includes("UPDATE") ||
      eventType.includes("CHECK") ||
      eventType.includes("CANCEL")
    ) {
      const updates = {};
      const endpt = `/v4/reservations/${reservation.res_id}`;

      // Map Status
      if (reservation.status === "CHECKED_IN") {
        await akiaService.send(endpt, { status: "checked_in" }, "PATCH");
        updates[HS.prop_status] = "CHECKED_IN";
      } else if (reservation.status === "CHECKED_OUT") {
        await akiaService.send(endpt, { status: "checked_out" }, "PATCH");
        updates[HS.prop_status] = "CHECKED_OUT";
      } else if (reservation.status === "CANCELLED") {
        await akiaService.send(endpt, { status: "cancelled" }, "PATCH");
        updates[HS.prop_status] = "CANCELLED";
      }

      // Map Details
      if (reservation.arrival) {
        await akiaService.send(
          endpt,
          {
            arrival_date: reservation.arrival,
            departure_date: reservation.departure,
            room_type: reservation.room,
          },
          "PATCH",
        );
        updates[HS.prop_arrival] = reservation.arrival;
        updates[HS.prop_room] = reservation.room;
      }

      if (Object.keys(updates).length > 0) {
        await hubspotService.pushDeal(reservation, updates);
      }
    }

    // 3. DIGITAL KEYS
    else if (
      eventType.includes("KEY") ||
      hookData.key_status === "ISSUED" ||
      hookData.key_status === "DELIVERED"
    ) {
      console.log(`Digital Key Issued for ${confirmationNumber}`);
      await akiaService.send("/integrations/events", {
        event_name: "digital_key_delivery",
        guest: { reservation_id: confirmationNumber },
      });
    }
  } catch (e) {
    console.error("Webhook Error:", e.message);
  }

  res.json({ received: true });
};
