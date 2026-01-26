const axios = require("axios");
const querystring = require("querystring");
const config = require("../config/env");
const tokenService = require("../services/tokenService");
const agilysysService = require("../services/agilysysService");

exports.login = (req, res) => {
  const scopes = "properties:read";

  const params = new URLSearchParams({
    client_id: config.AKIA.CLIENT_ID,
    scope: scopes,
    response_type: "code",
    redirect_uri: config.AKIA.REDIRECT_URI,
  });

  const authUrl = `https://sys.akia.com/oauth/authorize?${params.toString()}`;

  res.redirect(authUrl);
};

exports.callback = async (req, res) => {
  const { code } = req.query;

  if (!code) {
    console.error("Callback reached without an authorization code.");
    return res.status(400).send("No authorization code provided.");
  }

  try {
    const tokenParams = new URLSearchParams();
    tokenParams.append("grant_type", "authorization_code");
    tokenParams.append("code", code);
    tokenParams.append("client_id", config.AKIA.CLIENT_ID);
    tokenParams.append("client_secret", config.AKIA.CLIENT_SECRET);
    tokenParams.append("redirect_uri", config.AKIA.REDIRECT_URI);

    const resAuth = await axios.post(
      `${config.AKIA.BASE_URL}/oauth/token`,
      tokenParams.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 5000,
      }
    );

    const { access_token, expires_in } = resAuth.data;

    if (!access_token) {
      console.error(
        "Akia responded but no access_token was found in data:",
        resAuth.data
      );
      throw new Error("Token exchange failed: No access token in response.");
    }

    // 2. Save tokens to your service
    // await tokenService.saveTokens(resAuth.data);

    console.log(`Token acquired: ${access_token}. Expires in: ${expires_in}s.`);

    // console.log(
    //   `Fetching user info from: ${config.AKIA.BASE_URL}/v3/properties`
    // );

    // const resMe = await axios.get(`${config.AKIA.BASE_URL}/v3/properties`, {
    //   headers: {
    //     Authorization: `Bearer ${access_token.trim()}`,
    //     Accept: "application/json",
    //   },
    // });

    res.send(`
      <div style="font-family: sans-serif; padding: 20px;">
        <h1 style="color: green;">Success!</h1>
        <p>Token validated and User Profile retrieved.</p>
        <pre style="background: #f4f4f4; padding: 15px;"></pre>
      </div>
    `);
  } catch (e) {
    console.error("--- AUTHENTICATION FAILURE ---");

    if (e.response) {
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
      console.error(
        "No response received from Akia. Network issue or incorrect BASE_URL."
      );
      return res.status(504).send("Gateway Timeout: No response from Akia.");
    } else {
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
      `<pre>Webhook Registered!\n${JSON.stringify(apiRes.data, null, 2)}</pre>`
    );
  } catch (e) {
    res
      .status(500)
      .send(
        `<pre>Error:\n${JSON.stringify(
          e.response?.data || e.message,
          null,
          2
        )}</pre>`
      );
  }
};
