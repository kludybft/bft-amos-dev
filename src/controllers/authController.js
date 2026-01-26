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
    // 1. Exchange Auth Code for Access Token
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

    // Extract the access token immediately from the response
    const { access_token } = resAuth.data;

    // 2. Save tokens to your service
    await tokenService.saveTokens(resAuth.data);

    // 3. Run GET /v3/me using the fresh access token
    // This ensures we are using the valid token we just received
    const resMe = await axios.get(`${config.AKIA.BASE_URL}/v3/me`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
    });

    // Optional: Log the user data to console to verify it worked
    console.log("Akia User Info:", resMe.data);

    // 4. Send success response
    // (I added the user data to the response so you can see it on the screen)
    res.send(
      `<h1>Login Success!</h1><pre>${JSON.stringify(resMe.data, null, 2)}</pre>`,
    );
  } catch (e) {
    // Helpful for debugging: check if the error came from the second call
    const errorMsg = e.response ? JSON.stringify(e.response.data) : e.message;
    console.error("Login Error:", errorMsg);
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
