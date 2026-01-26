const axios = require("axios");
const querystring = require("querystring");
const config = require("../config/env");
const tokenService = require("../services/tokenService");
const agilysysService = require("../services/agilysysService");

exports.login = (req, res) => {
  const scopes =
    "customers:read,customers:write,properties:read,properties:write,users:read,users:write";

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

  // Early exit if no code is present
  if (!code) {
    console.error("Callback reached without an authorization code.");
    return res.status(400).send("No authorization code provided.");
  }

  try {
    // 1. Exchange Code for Token
    const tokenParams = new URLSearchParams();
    tokenParams.append("grant_type", "authorization_code");
    tokenParams.append("code", code);
    tokenParams.append("client_id", config.AKIA.CLIENT_ID);
    tokenParams.append("client_secret", config.AKIA.CLIENT_SECRET);
    tokenParams.append("redirect_uri", config.AKIA.REDIRECT_URI);

    console.log("Exchanging code for token...");

    const resAuth = await axios.post(
      `${config.AKIA.BASE_URL}/oauth/token`,
      tokenParams.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 5000, // 5-second timeout to prevent hanging
      },
    );

    // 2. Extract and Validate Token
    const { access_token, expires_in, scope } = resAuth.data;

    if (!access_token) {
      console.error(
        "Akia responded but no access_token was found in data:",
        resAuth.data,
      );
      throw new Error("Token exchange failed: No access token in response.");
    }

    // Log token metadata for debugging (avoid logging the full secret token in production)
    console.log(`Token acquired. Expires in: ${expires_in}s. Scopes: ${scope}`);

    // 3. Fetch User Info (Skipping DB save for now)
    console.log(`Fetching user info from: ${config.AKIA.BASE_URL}/v3/me`);

    const resMe = await axios.get(`${config.AKIA.BASE_URL}/v3/me`, {
      headers: {
        Authorization: `Bearer ${access_token.trim()}`,
        Accept: "application/json",
      },
    });

    // 4. Final Success Response
    res.send(`
      <div style="font-family: sans-serif; padding: 20px;">
        <h1 style="color: green;">Success!</h1>
        <p>Token validated and User Profile retrieved.</p>
        <pre style="background: #f4f4f4; padding: 15px;">${JSON.stringify(resMe.data, null, 2)}</pre>
      </div>
    `);
  } catch (e) {
    console.error("--- AUTHENTICATION FAILURE ---");

    if (e.response) {
      // The server responded with a status code outside the 2xx range
      const status = e.response.status;
      const details = JSON.stringify(e.response.data);

      console.error(`Status: ${status}`);
      console.error(`Response Data: ${details}`);
      console.error(`Request Config: ${e.config.url}`);

      return res.status(status).json({
        error: "Akia API Error",
        status: status,
        details: e.response.data,
      });
    } else if (e.request) {
      // The request was made but no response was received
      console.error(
        "No response received from Akia. Network issue or incorrect BASE_URL.",
      );
      return res.status(504).send("Gateway Timeout: No response from Akia.");
    } else {
      // Something happened in setting up the request
      console.error("Request Setup Error:", e.message);
      return res.status(500).send(`Application Error: ${e.message}`);
    }
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
