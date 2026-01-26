const axios = require("axios");
const querystring = require("querystring");
const config = require("../config/env");
const tokenService = require("../services/tokenService");
const agilysysService = require("../services/agilysysService");

exports.login = (req, res) => {
  const scopes =
    "customers:read,customers:write,properties:read,properties:write";
  const url = `https://sys.akia.com/oauth/authorize?client_id=${config.AKIA.CLIENT_ID}&scope=${scopes}&response_type=code&redirect_uri=${encodeURIComponent(config.AKIA.REDIRECT_URI)}`;
  res.redirect(url);
};

exports.callback = async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("No code.");

  try {
    // 1. Get Token
    const resAuth = await axios.post(
      `${config.AKIA.BASE_URL}/oauth/token`,
      querystring.stringify({
        code,
        grant_type: "authorization_code",
        client_id: config.AKIA.CLIENT_ID,
        client_secret: config.AKIA.CLIENT_SECRET,
        redirect_uri: config.AKIA.REDIRECT_URI,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const { access_token, scope } = resAuth.data; // Akia usually returns the granted scope too

    // DEBUG: Print exactly what we got
    console.log("1. Token Response:", JSON.stringify(resAuth.data, null, 2));

    if (!access_token) throw new Error("No access_token in response");

    // 2. Save Token
    await tokenService.saveTokens(resAuth.data);

    // 3. Call /v3/me
    console.log(`2. Attempting GET ${config.AKIA.BASE_URL}/v3/me`);
    console.log(`3. Using Scope: ${scope}`);

    // Explicitly construct headers to ensure no hidden types
    const headers = {
      Authorization: `Bearer ${String(access_token).trim()}`, // Force string and trim whitespace
      "Content-Type": "application/json",
    };

    const resMe = await axios.get(`${config.AKIA.BASE_URL}/v3/me`, { headers });

    res.send(
      `<h1>Success</h1><pre>${JSON.stringify(resMe.data, null, 2)}</pre>`,
    );
  } catch (e) {
    console.error("--- FAILURE LOG ---");
    if (e.response) {
      // The server responded with a 401
      console.error("Status:", e.response.status);
      console.error("Server Message:", JSON.stringify(e.response.data));
      console.error("Headers Sent:", JSON.stringify(e.config.headers)); // Check this log specifically!
    } else {
      console.error("Error:", e.message);
    }
    res.status(500).send(`Error: ${e.message}`);
  }
};

exports.registerWebhook = async (req, res) => {
  const MY_URL =
    "https://3d1ddc13-060d-4411-992a-9ad6545cdf18-dev.e1-us-east-azure.choreoapis.dev/amos-interfacing/bft-amos-dev/v1.0/webhook";

  try {
    const { token, session } = await agilysysService.getBookingAuth();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (session) headers["SessionId"] = session;

    const payload = {
      endpointUrl: MY_URL,
      eventTypes: [
        "RESERVATION_CREATED",
        "RESERVATION_UPDATED",
        "RESERVATION_CANCELLED",
        "CHECK_IN",
        "CHECK_OUT",
      ],
    };
    const apiRes = await axios.post(config.AGILYSYS.SUB_URL, payload, {
      headers,
    });
    res.send(
      `<pre>Webhook Registered!\n${JSON.stringify(apiRes.data, null, 2)}</pre>`,
    );
  } catch (e) {
    res
      .status(500)
      .send(
        `<pre>Error:\n${JSON.stringify(e.response?.data || e.message, null, 2)}</pre>`,
      );
  }
};
