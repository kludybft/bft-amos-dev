const axios = require("axios");
const config = require("../config/env");

exports.getBookingAuth = async () => {
  try {
    const res = await axios.post(
      config.AGILYSYS.BOOKING_AUTH_URL,
      config.AGILYSYS.CREDENTIALS,
    );

    const token =
      res.data.BearerToken || res.data.token || res.headers["authorization"];
    const session = res.data.SessionId || res.data.sessionId;

    if (!token) throw new Error("No Access Token in Agilysys Response.");
    return { token, session };
  } catch (e) {
    console.error("Agilysys Booking Auth Error:", e.message);
    throw e;
  }
};

exports.getSpaAuth = async () => {
  try {
    const res = await axios.post(
      config.AGILYSYS.SPA_AUTH_URL,
      config.AGILYSYS.CREDENTIALS,
    );

    const token =
      res.data.BearerToken || res.data.token || res.headers["authorization"];
    const session = res.data.SessionId || res.data.sessionId;

    if (!token) throw new Error("No Access Token in Agilysys Response.");
    return { token, session };
  } catch (e) {
    console.error("Agilysys Spa Auth Error:", e.message);
    throw e;
  }
};

exports.getReservation = async (confirmationNumber) => {
  try {
    const { token, session } = await exports.getBookingAuth();
    const headers = { Authorization: `Bearer ${token}` };
    if (session) headers["SessionId"] = session;

    const res = await axios.get(
      `${config.AGILYSYS.BOOKING_URL}/${confirmationNumber}`,
      { headers },
    );

    return res.data;
  } catch (error) {
    console.error("Failed to fetch reservation:", error.message);

    if (error.response && error.response.status === 404) {
      console.log("No reservation found.");
      return null;
    }

    console.warn("Booking API Error:", error.message);
    return null;
  }
};

exports.getSpaAppointment = async (source) => {
  try {
    const { token, session } = await exports.getSpaAuth();
    const headers = { Authorization: `Bearer ${token}` };
    if (session) headers["SessionId"] = session;

    const res = await axios.get(`${config.AGILYSYS.SPA_URL}/${source}`, {
      headers,
    });

    return res.data.appointments || res.data.value || res.data || [];
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log("No spa appointment found.");
      return [];
    }

    console.warn("Spa API Error:", error.message);
    return [];
  }
};
