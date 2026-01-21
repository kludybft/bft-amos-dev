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
    await tokenService.saveTokens(resAuth.data);
    res.send("<h1>Login Success!</h1>");
  } catch (e) {
    res.status(500).send(`Error: ${e.message}`);
  }
};

exports.setupWebhook = async (req, res) => {
  const MY_URL = "https://YOUR-CHOREO-APP.choreoapps.dev/webhook";

  try {
    const { token, session } = await agilysysService.getAuth();
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
        "KEY_ISSUED",
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
