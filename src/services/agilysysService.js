const axios = require("axios");
const config = require("../config/env");

exports.getAuth = async () => {
  console.log("Requesting Agilysys Token...");
  try {
    const res = await axios.post(
      config.AGILYSYS.AUTH_URL,
      config.AGILYSYS.CREDENTIALS,
    );

    const token =
      res.data.BearerToken || res.data.token || res.headers["authorization"];
    const session = res.data.SessionId || res.data.sessionId;

    if (!token) throw new Error("No Access Token in Agilysys Response.");
    return { token, session };
  } catch (e) {
    console.error("Agilysys Auth Error:", e.message);
    throw e;
  }
};

exports.fetchDetails = async (resId) => {
  console.log(`Fetching details for ${resId}...`);
  try {
    const { token, session } = await exports.getAuth();
    const headers = { Authorization: `Bearer ${token}` };
    if (session) headers["SessionId"] = session;

    const res = await axios.get(`${config.AGILYSYS.BOOKING_URL}/${resId}`, {
      headers,
    });
    return res.data;
  } catch (e) {
    console.error("Failed to fetch Agilysys Details:", e.message);
    return null;
  }
};
