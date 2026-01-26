const axios = require("axios");
const querystring = require("querystring");
const config = require("../config/env");
const tokenService = require("../services/tokenService");
const agilysysService = require("../services/agilysysService");

exports.login = (req, res) => {
  const scopes =
    "customers:read,customers:write,properties:read,properties:write";

  // Construct the Akia Auth URL
  const params = new URLSearchParams({
    client_id: config.AKIA.CLIENT_ID,
    scope: scopes,
    response_type: "code",
    redirect_uri: config.AKIA.REDIRECT_URI, // Ensure this matches EXACTLY what is in Akia dashboard
  });

  const authUrl = `https://sys.akia.com/oauth/authorize?${params.toString()}`;

  // Send the user to Akia
  res.redirect(authUrl);
};

exports.callback = async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("No authorization code provided.");

  try {
    // 1. Exchange Code for Token
    // Use URLSearchParams for x-www-form-urlencoded data
    const tokenParams = new URLSearchParams();
    tokenParams.append("grant_type", "authorization_code");
    tokenParams.append("code", code);
    tokenParams.append("client_id", config.AKIA.CLIENT_ID);
    tokenParams.append("client_secret", config.AKIA.CLIENT_SECRET);
    tokenParams.append("redirect_uri", config.AKIA.REDIRECT_URI);

    const resAuth = await axios.post(
      `${config.AKIA.BASE_URL}/oauth/token`,
      tokenParams.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const { access_token } = resAuth.data;

    if (!access_token) {
      throw new Error("Token exchange failed: No access token received.");
    }

    // 2. Save Token
    await tokenService.saveTokens(resAuth.data);

    // 3. Fetch User Info
    // Note: Ensure /v3/me is the correct endpoint for Akia
    const resMe = await axios.get(`${config.AKIA.BASE_URL}/v3/me`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
    });

    res.send(
      `<h1>Success</h1><pre>${JSON.stringify(resMe.data, null, 2)}</pre>`,
    );
  } catch (e) {
    console.error("--- OAUTH ERROR ---");
    const errorData = e.response ? e.response.data : e.message;
    console.error(errorData);

    res.status(500).json({
      message: "Authentication failed",
      details: errorData,
    });
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
